import type { SemanticGraphLite } from './semanticGraphLite.js';
import type { ResponseNode, PhraseNode } from '../types/index.js';
import { analyze, extractChunks } from './nlp.js';
import { promoteChunk } from './ingest.js';
import { generatePosPattern, processPropnSpans } from './posNormalization.js';
import { isStopWord, getStopWordRatio } from './stopWords.js';
import { analyzeWordPOS } from './posAnalysis.js';
import { IngestionPipeline } from './ingest.js';
import { recordChunks } from './chunkCatalog.js';

export interface ResponseResult {
  responseNode: ResponseNode;
  wordIds: string[];
  canPromote: boolean;
  promotionSuggestion?: string;
}

export class ResponseEngine {
  private static instance: ResponseEngine;

  static getInstance(): ResponseEngine {
    if (!ResponseEngine.instance) {
      ResponseEngine.instance = new ResponseEngine();
    }

    return ResponseEngine.instance;
  }

  async recordResponse(
    promptId: string,
    text: string,
    graph: SemanticGraphLite,
    rating?: 'like' | 'skip',
    usePhraseSplitting?: boolean
  ): Promise<ResponseResult> {
    // If phrase splitting is enabled, use the new method
    if (usePhraseSplitting) {
      const results = await this.recordResponseWithPhraseSplitting(promptId, text, graph, rating);
      // Return the first result for backward compatibility
      return results[0];
    }

    // Original single response processing
    return this.processSingleResponse(promptId, text, graph, rating);
  }

  private async processSingleResponse(
    promptId: string,
    text: string,
    graph: SemanticGraphLite,
    rating?: 'like' | 'skip'
  ): Promise<ResponseResult> {
    // Use the same analysis pipeline as phrases
    const norm = await analyze(text);
    const { tokens, compounds } = norm;
    
    if (tokens.length === 0) {
      throw new Error('No tokens found in response text');
    }

    // Check if response is only stop words
    const contentWords = tokens.filter(token => !isStopWord(token.value));
    if (contentWords.length === 0) {
      throw new Error('Response contains only stop words and cannot be processed');
    }

    // Check if response has too many stop words (more than 70%)
    const stopWordRatio = getStopWordRatio(tokens.map(t => t.value));
    if (stopWordRatio > 0.7) {
      throw new Error(`Response has too many stop words (${(stopWordRatio * 100).toFixed(1)}%). Maximum allowed is 70%.`);
    }

    // Build/merge WORD nodes using the same logic as phrases
    const wordMap = new Map<string, string>(); // lemma -> wordId
    
    // Step 1: Insert compound nodes (collapsed multi-token PROPN) first
    for (const compound of compounds) {
      // Ensure compound lemma exists and is a string
      if (!compound.lemma || typeof compound.lemma !== 'string') {
        continue;
      }
      
      const normalizedLemma = compound.lemma.toLowerCase();
      
      if (!wordMap.has(normalizedLemma)) {
        const analysis = await analyzeWordPOS(normalizedLemma, compound.pos);
        
        // Create word with normalized lemma as both text and lemma
        const word = graph.upsertWord(normalizedLemma, normalizedLemma, analysis.pos, compound.pos);
        
        word.isPolysemousPOS = analysis.isPolysemous;
        word.posPotential = analysis.pos;
        word.posPotentialSource = [analysis.source];
        
        wordMap.set(normalizedLemma, word.id);
      } else {
        // Update existing word with current POS observation
        graph.upsertWord(normalizedLemma, normalizedLemma, [], compound.pos);
      }
    }

    // Step 2: Insert remaining tokens that are marked keep=true
    for (const token of tokens) {
      if (!token.keep) continue; // skip compound members and possessive 's
      
      // Belt & suspenders: skip stop words even if they somehow got through
      if (isStopWord(token.lemma) || isStopWord(token.value)) continue;
      
      // Ensure lemma exists and is a string
      if (!token.lemma || typeof token.lemma !== 'string') {
        continue;
      }
      
      const normalizedLemma = token.lemma.toLowerCase();
      
      if (!wordMap.has(normalizedLemma)) {
        const analysis = await analyzeWordPOS(normalizedLemma, token.pos);
        
        // Create word with normalized lemma as both text and lemma
        const word = graph.upsertWord(normalizedLemma, normalizedLemma, analysis.pos, token.pos);
        
        word.isPolysemousPOS = analysis.isPolysemous;
        word.posPotential = analysis.pos;
        word.posPotentialSource = [analysis.source];
        
        wordMap.set(normalizedLemma, word.id);
      } else {
        // Update existing word with current POS observation
        graph.upsertWord(normalizedLemma, normalizedLemma, [], token.pos);
      }
    }

    // Step 3: Compute response posPattern (using normalized POS)
    const posPattern = generatePosPattern(tokens.map(t => t.pos));

    // Step 4: Create response node with clean lemmas (no stop words)
    const lemmas = tokens.map(t => t.lemma);
    const pos = tokens.map(t => t.pos);
    const validWordIds = Array.from(wordMap.values());
    const responseNode = graph.recordResponse(
      promptId,
      text,
      lemmas,
      posPattern,
      validWordIds,
      rating
    );

    // Step 5: Extract chunks and attach to response (using existing pipeline)
    const chunks = extractChunks(lemmas, pos);
    const topChunks = chunks.slice(0, 8); // Cap to top K=8 by score
    graph.addChunksToResponse(responseNode.id, topChunks);

    // Step 6: Update chunk catalog
    recordChunks(responseNode.id, topChunks);

    // Check if response can be promoted to a phrase
    const canPromote = this.canPromoteResponse(text, tokens.length, posPattern);
    const promotionSuggestion = canPromote ? 
      'This response could be promoted to a reusable phrase' : undefined;

    return {
      responseNode,
      wordIds: validWordIds,
      canPromote,
      promotionSuggestion,
    };
  }

  promoteResponseToPhrase(
    responseId: string,
    graph: SemanticGraphLite
  ): PhraseNode | null {
    const response = graph.getNodesByType('RESPONSE').find(r => r.id === responseId) as ResponseNode;
    if (!response) {
      throw new Error(`Response ${responseId} not found`);
    }

    // Create a temporary chunk-like structure for promotion
    const tempChunk = {
      id: `response:${responseId}`,
      text: response.text,
      lemmas: response.lemmas,
      posPattern: response.posPattern,
      span: [0, response.lemmas.length - 1] as [number, number],
      score: this.calculateResponseScore(response),
    };

    // Create WORD nodes for response lemmas
    const wordIds: string[] = [];
    response.lemmas.forEach((lemma, index) => {
      const word = graph.upsertWord(lemma, lemma, [response.posPattern.split('-')[index] || 'X']);
      wordIds.push(word.id);
    });

    // Create new PHRASE node from response
    const promotedPhrase = graph.upsertPhrase(
      response.text,
      response.lemmas,
      response.posPattern,
      wordIds,
      responseId // derivedFromId
    );

    return promotedPhrase;
  }

  private calculateResponseScore(response: ResponseNode): number {
    // Simple scoring based on length and content
    let score = 1.0;
    
    // Length bonus
    if (response.lemmas.length >= 3 && response.lemmas.length <= 8) {
      score += 0.5;
    }
    
    // Content word ratio bonus
    const contentWords = response.lemmas.filter(lemma => !isStopWord(lemma));
    const contentRatio = contentWords.length / response.lemmas.length;
    if (contentRatio > 0.7) {
      score += 0.3;
    }
    
    return score;
  }

  private canPromoteResponse(text: string, tokenCount: number, posPattern: string): boolean {
    // Similar logic to phrase promotion
    return tokenCount >= 3 && 
           tokenCount <= 12 && 
           posPattern.split('-').length >= 3 &&
           !text.includes('?') && 
           !text.includes('!');
  }

  async recordResponseWithPhraseSplitting(
    promptId: string,
    text: string,
    graph: SemanticGraphLite,
    rating?: 'like' | 'skip'
  ): Promise<ResponseResult[]> {
    // Split text into sentences
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    if (sentences.length === 0) {
      throw new Error('No valid sentences found in response text');
    }

    const results: ResponseResult[] = [];
    
    for (const sentence of sentences) {
      if (sentence.trim().length > 0) {
        const result = await this.processSingleResponse(promptId, sentence.trim(), graph, rating);
        results.push(result);
      }
    }
    
    return results;
  }
}

// Export singleton instance and convenience functions
export const responseEngine = ResponseEngine.getInstance();

export const recordResponse = async (
  promptId: string,
  text: string,
  graph: SemanticGraphLite,
  rating?: 'like' | 'skip',
  usePhraseSplitting?: boolean
) => responseEngine.recordResponse(promptId, text, graph, rating, usePhraseSplitting);

export const promoteResponseToPhrase = (
  responseId: string,
  graph: SemanticGraphLite
) => responseEngine.promoteResponseToPhrase(responseId, graph);

// Utility functions for response management
export const getResponsesForPrompt = (promptId: string, graph: SemanticGraphLite): ResponseNode[] => {
  return graph.getNodesByType('RESPONSE').filter(node => 
    (node as ResponseNode).promptId === promptId
  ) as ResponseNode[];
};

export const reassembleCompleteResponse = (promptId: string, graph: SemanticGraphLite): string => {
  const responses = getResponsesForPrompt(promptId, graph);
  if (responses.length === 0) return '';
  
  // Sort by creation time to maintain order
  responses.sort((a, b) => a.createdAt - b.createdAt);
  
  return responses.map(r => r.text).join(' ');
};

export const rateResponse = (responseId: string, rating: 'like' | 'skip', graph: SemanticGraphLite): void => {
  const response = graph.getNodesByType('RESPONSE').find(r => r.id === responseId) as ResponseNode;
  if (!response) {
    throw new Error(`Response ${responseId} not found`);
  }
  
  // Update the rating
  response.rating = rating;
};