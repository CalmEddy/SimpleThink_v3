/**
 * GloVe Embeddings Service
 * 
 * Provides word-to-vector lookup and semantic similarity calculations
 * using the GloVe 6B.50d dataset.
 */

import type { GloVeEmbeddings } from './embeddings.js';

export class GloVeService implements GloVeEmbeddings {
  private vectors = new Map<string, Float32Array>();
  private dimension = 50;
  private isLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor() {
    // Initialize empty service
  }

  async loadModel(url: string): Promise<void> {
    if (this.isLoaded) {
      console.log('[GloVe] Model already loaded');
      return;
    }
    
    if (this.loadingPromise) {
      console.log('[GloVe] Loading already in progress');
      return this.loadingPromise;
    }

    console.log('[GloVe] Starting to load model from:', url);
    this.loadingPromise = this._loadModel(url);
    return this.loadingPromise;
  }

  private async _loadModel(url: string): Promise<void> {
    try {
      console.log('[GloVe] Loading embeddings from:', url);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load GloVe data: ${response.status} ${response.statusText}`);
      }
      
      const text = await response.text();
      const lines = text.trim().split('\n');
      
      console.log(`[GloVe] Parsing ${lines.length} word vectors...`);
      
      for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts.length < 2) continue;
        
        const word = parts[0];
        const values = new Float32Array(parts.slice(1).map(Number));
        
        if (values.length === this.dimension) {
          this.vectors.set(word, values);
        }
      }
      
      this.isLoaded = true;
      console.log(`[GloVe] Loaded ${this.vectors.size} word vectors`);
      
    } catch (error) {
      console.error('[GloVe] Failed to load model:', error);
      this.loadingPromise = null;
      // Don't throw the error - just log it and continue without GloVe
      console.warn('[GloVe] Continuing without GloVe embeddings. Semantic Neighborhood will be disabled.');
    }
  }

  getVector(word: string): Float32Array | null {
    if (!this.isLoaded) {
      console.warn('[GloVe] Model not loaded yet');
      return null;
    }
    
    const normalizedWord = word.toLowerCase().trim();
    return this.vectors.get(normalizedWord) || null;
  }

  getSimilarity(word1: string, word2: string): number {
    const vec1 = this.getVector(word1);
    const vec2 = this.getVector(word2);
    
    if (!vec1 || !vec2) {
      return 0;
    }
    
    return this.cosineSimilarity(vec1, vec2);
  }

  private cosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Convert a phrase to a vector using average pooling
   */
  phraseToVector(phraseLemmas: string[], stopWords?: Set<string>): Float32Array | null {
    if (!this.isLoaded || phraseLemmas.length === 0) {
      return null;
    }
    
    // Filter out stop words if provided
    const filteredLemmas = stopWords 
      ? phraseLemmas.filter(lemma => !stopWords.has(lemma.toLowerCase()))
      : phraseLemmas;
    
    if (filteredLemmas.length === 0) {
      return null;
    }
    
    // Get vectors for all words
    const vectors: Float32Array[] = [];
    for (const lemma of filteredLemmas) {
      const vector = this.getVector(lemma);
      if (vector) {
        vectors.push(vector);
      }
    }
    
    if (vectors.length === 0) {
      return null;
    }
    
    // Average pooling
    const result = new Float32Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      let sum = 0;
      for (const vector of vectors) {
        sum += vector[i];
      }
      result[i] = sum / vectors.length;
    }
    
    return result;
  }

  /**
   * Calculate similarity between two phrases
   */
  phraseSimilarity(phrase1Lemmas: string[], phrase2Lemmas: string[], stopWords?: Set<string>): number {
    const vec1 = this.phraseToVector(phrase1Lemmas, stopWords);
    const vec2 = this.phraseToVector(phrase2Lemmas, stopWords);
    
    if (!vec1 || !vec2) {
      return 0;
    }
    
    return this.cosineSimilarity(vec1, vec2);
  }

  /**
   * Find phrases most similar to a given phrase
   */
  findSimilarPhrases(
    targetPhraseLemmas: string[],
    candidatePhrases: Array<{ id: string; lemmas: string[] }>,
    k: number = 5,
    stopWords?: Set<string>
  ): Array<{ phraseId: string; similarity: number }> {
    console.log('[GloVe] findSimilarPhrases called with:', {
      targetLemmas: targetPhraseLemmas,
      candidateCount: candidatePhrases.length,
      k,
      stopWordsSize: stopWords?.size
    });
    
    const targetVector = this.phraseToVector(targetPhraseLemmas, stopWords);
    if (!targetVector) {
      console.log('[GloVe] No target vector created - returning empty results');
      return [];
    }
    
    console.log('[GloVe] Target vector created, processing', candidatePhrases.length, 'candidates');
    
    const similarities: Array<{ phraseId: string; similarity: number }> = [];
    
    for (const candidate of candidatePhrases) {
      const candidateVector = this.phraseToVector(candidate.lemmas, stopWords);
      if (candidateVector) {
        const similarity = this.cosineSimilarity(targetVector, candidateVector);
        similarities.push({
          phraseId: candidate.id,
          similarity
        });
      }
    }
    
    console.log('[GloVe] Found', similarities.length, 'similarities, top similarities:', 
      similarities.slice(0, 3).map(s => ({ id: s.phraseId, sim: s.similarity.toFixed(3) }))
    );
    
    // Sort by similarity (descending) and return top k
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  getLoadedStatus(): boolean {
    return this.isLoaded;
  }

  getVectorCount(): number {
    return this.vectors.size;
  }

  getSimilarWords(word: string, limit: number): Array<{ word: string; similarity: number }> {
    const targetVector = this.getVector(word);
    if (!targetVector) {
      return [];
    }

    const similarities: Array<{ word: string; similarity: number }> = [];
    
    for (const [candidateWord, candidateVector] of this.vectors) {
      if (candidateWord !== word.toLowerCase()) {
        const similarity = this.cosineSimilarity(targetVector, candidateVector);
        similarities.push({
          word: candidateWord,
          similarity
        });
      }
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}

// Singleton instance
export const gloveService = new GloVeService();
