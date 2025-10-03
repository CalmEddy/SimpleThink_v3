import React, { useEffect, useMemo, useRef, useState } from "react";
import { useActiveNodesWithGraph } from "../contexts/ActiveNodesContext";
import { SemanticGraphLite } from "../lib/semanticGraphLite";
import {
  AspectProfile,
  inferAspect, // convenience wrapper (still available for ad-hoc text)
  buildAspectProfiles,
  loadEmbeddingsFromFile,
  loadEmbeddingsFromString,
  EmbeddingMap,
  DEFAULT_WEIGHTS,
  Weights,
  normalizeLemma,
  tokenizeToLemmas,
  tokenizeToContentWords,
  getGrammaticalWeight
} from "../lib/aspect/inferAspect";
import { computeAspectTag } from "../lib/aspect/computeAspectTag";
import { isStopWord } from "../lib/stopWords";
import TopicChip from "./TopicChip";
import { PromptEngine } from "../lib/promptEngine";
import { ResponseEngine } from "../lib/respond";
import { TEMPLATES } from "../lib/templates";
import { analyze } from "../lib/nlp";
import type { PromptNode, ResponseNode } from "../types";

// Minimal shape (avoid coupling to deeper app types)
type PhraseNode = { id: string; type: "PHRASE"; text: string; lemmas: string[]; posPattern: string };

interface AspectTesterProps {
  graph: SemanticGraphLite;
}

/**
 * AspectTester (read-only)
 * - Pick a topic from the active graph (actual Topic nodes, not phrases)
 * - Shows its sub-topics (lemmas) with stop words filtered out
 * - Type any test phrase and see which sub-topic it would align with
 * - Optional GloVe loading (TXT or JSON) to power related-word & similarity scoring
 * - No writes, no graph mutations. Purely exploratory.
 */
export default function AspectTester({ graph }: AspectTesterProps) {
  const { ctx, contextFrame } = useActiveNodesWithGraph(graph);
  
  // Get the current topic from the context frame (unified topic selection)
  const selectedTopic = useMemo(() => {
    if (!contextFrame?.topicId) return null;
    const topic = graph.getNode(contextFrame.topicId);
    return topic ? {
      id: topic.id,
      type: topic.type,
      text: topic.text,
      lemmas: topic.lemmas || [],
      posPattern: topic.posPattern || ''
    } : null;
  }, [contextFrame?.topicId, graph]);

  // Embeddings
  const [embMap, setEmbMap] = useState<EmbeddingMap | null>(null);
  const [embDim, setEmbDim] = useState<number>(0);
  const [embCount, setEmbCount] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Controls (non-technical labels)
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
  const [haloK, setHaloK] = useState<number>(8); // "How many related words to consider?"
  const [properGuard, setProperGuard] = useState<boolean>(true);

  // Budget for neighbor search (fast with big GloVe)
  const [neighborBudget, setNeighborBudget] = useState<number>(20000);

  const aspects = useMemo<AspectProfile[]>(() => {
    if (!selectedTopic) return [];
    // normalize topic lemmas: strip punctuation, lowercase, drop stopwords using global wordbank
    const raw = (selectedTopic.lemmas ?? []).filter(Boolean);
    const cleaned = raw
      .map(normalizeLemma)
      .filter(l => l && !isStopWord(l));
    return buildAspectProfiles(cleaned, embMap, haloK, neighborBudget);
  }, [selectedTopic, embMap, haloK, neighborBudget]);

  // Test phrase and results
  const [testText, setTestText] = useState<string>("");
  const [result, setResult] = useState<null | {
    bestId: string;
    confidence: number;
    ranked: Array<{ id: string; score: number }>;
  }>(null);
  const [lemmaTokensUsed, setLemmaTokensUsed] = useState<string[] | null>(null);
  const [lemmaEngineLabel, setLemmaEngineLabel] = useState<string>("(none)");

  // Prompt and response state
  const [currentPrompt, setCurrentPrompt] = useState<PromptNode | null>(null);
  const [responseText, setResponseText] = useState<string>("");
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [lastResponse, setLastResponse] = useState<ResponseNode | null>(null);
  const [promptLemmas, setPromptLemmas] = useState<string[]>([]);
  const [phraseResults, setPhraseResults] = useState<Array<{
    phrase: string;
    tokens: string[];
    aspect: string;
    confidence: number;
    score: number;
    ranked: Array<{ id: string; score: number }>;
  }>>([]);

  // Get a lemma function and winkNLP instance, preferring the app's winkNLP.
  // Priority:
  // 1) window.appLemma(text) exposed by the app
  // 2) window.nlp + window.its (winkNLP instance exposed by the app)
  const [lemmaFn, setLemmaFn] = useState<null | ((t: string) => string[])>(null);
  const [winkNLPInstance, setWinkNLPInstance] = useState<null | { nlp: any; its: any }>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w: any = window;
    if (typeof w.appLemma === 'function') {
      setLemmaFn(() => (text: string) => (w.appLemma as any)(text));
      setLemmaEngineLabel("winkNLP (appLemma)");
      // Try to get the underlying winkNLP instance for computeAspectTag
      if (w.nlp && w.its) {
        setWinkNLPInstance({ nlp: w.nlp, its: w.its });
      }
      return;
    }
    if (w.nlp && w.its && typeof w.nlp.readDoc === 'function') {
      setLemmaFn(() => (text: string) => w.nlp.readDoc(text).tokens().out(w.its.lemma).map((s: string) => String(s).toLowerCase()));
      setLemmaEngineLabel("winkNLP (window.nlp)");
      setWinkNLPInstance({ nlp: w.nlp, its: w.its });
      return;
    }
    // No winkNLP available from the app
    setLemmaFn(null);
    setWinkNLPInstance(null);
    setLemmaEngineLabel("(none)");
  }, []);

  // Generate a prompt using the full prompt engine capabilities (read-only, no graph modification)
  const generatePrompt = async () => {
    if (!selectedTopic) {
      alert("Please choose a topic first.");
      return;
    }
    
    try {
      const promptEngine = PromptEngine.getInstance();
      
      // Check if we have any contextual data
      if (ctx.phrases.length === 0 && ctx.words.length === 0 && ctx.chunks.length === 0) {
        alert("No phrases, words, or chunks available for this topic. Please ingest some content first.");
        return;
      }
      
      // Use the enhanced prompt generation with full active context
      const sessionId = contextFrame?.sessionId || '__global__';
      const promptResult = await promptEngine.generateEnhancedPrompt(
        ctx, // Full active context (phrases, words, chunks, etc.)
        graph,
        sessionId,
        undefined, // No specific RNG
        undefined, // No locked template doc
        undefined, // No locked template ID
        0.5 // Template mix ratio (50% generated, 50% user templates)
      );
      
      // Create a mock prompt node for display only (not saved to graph)
      const mockPromptNode: PromptNode = {
        id: `mock-${Date.now()}`, // Temporary ID for display
        type: 'PROMPT',
        templateId: promptResult.templateId,
        templateText: promptResult.templateText,
        bindings: [], // Enhanced generation doesn't provide detailed bindings
        createdAt: Date.now(),
      };
      
      setCurrentPrompt(mockPromptNode);
      
      // Extract lemmas from the prompt text using existing NLP pipeline
      try {
        const norm = await analyze(promptResult.templateText);
        const extractedLemmas = norm.tokens
          .map(token => token.lemma.toLowerCase())
          .filter(lemma => !isStopWord(lemma));
        setPromptLemmas(extractedLemmas);
      } catch (error) {
        console.warn('Failed to extract prompt lemmas:', error);
        setPromptLemmas([]);
      }
      
      setResponseText(""); // Clear previous response
      setPhraseResults([]); // Clear previous phrase results
      
      // Log debug info for transparency
      console.log('Generated prompt using full context:', {
        phrases: ctx.phrases.length,
        words: ctx.words.length,
        chunks: ctx.chunks.length,
        templateId: promptResult.templateId,
        debug: promptResult.debug
      });
      
    } catch (error) {
      alert(`Failed to generate prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error('Prompt generation error:', error);
    }
  };

  // Handle response submission (read-only, no graph modification)
  const handleResponseSubmit = async () => {
    if (!currentPrompt || !responseText.trim()) {
      alert("Please enter a response.");
      return;
    }
    
    try {
      setIsSubmittingResponse(true);
      
      // Simulate response processing without saving to graph
      // We'll analyze the text directly for aspect testing
      const responseTextTrimmed = responseText.trim();
      
      // Create a mock response node for display only
      const mockResponseNode: ResponseNode = {
        id: `mock-response-${Date.now()}`, // Temporary ID for display
        type: 'RESPONSE',
        text: responseTextTrimmed,
        lemmas: [], // Will be populated by analysis
        posPattern: '', // Will be populated by analysis
        promptId: currentPrompt.id,
        createdAt: Date.now(),
      };
      
      // Analyze the response text using multi-phrase processing
      if (lemmaFn) {
        // Split response into phrases using existing logic from ingest pipeline
        const normalizedText = responseTextTrimmed.replace(/\r\n|\r/g, '\n');
        const phrases = normalizedText
          .split(/(?<=[.!?])\s*|\n/)
          .map(phrase => phrase.trim())
          .filter(phrase => phrase.length > 0);
        
        // Process each phrase separately
        const phraseResults = [];
        let allTokens: string[] = [];
        
        for (const phrase of phrases) {
          // Use the same analyze function as the ingester for consistent lemmatization
          const norm = await analyze(phrase);
          const tokens = norm.tokens.map(token => token.lemma.toLowerCase());
          allTokens.push(...tokens);
          
          // Create POS-weighted tokens for enhanced aspect scoring
          const posWeightedTokens = norm.tokens.map(token => ({
            lemma: token.lemma.toLowerCase(),
            pos: token.pos,
            weight: getGrammaticalWeight(token.pos)
          }));
          
          // Run aspect analysis on each phrase with prompt lemmas as context
          if (aspects.length > 0) {
            const combinedTokens = [...tokens, ...promptLemmas];
            
            // Create combined POS-weighted tokens (phrase tokens + prompt lemmas with default weight)
            const combinedPosWeightedTokens = [
              ...posWeightedTokens,
              ...promptLemmas.map(lemma => ({
                lemma: lemma.toLowerCase(),
                pos: 'NOUN', // Assume prompt lemmas are nouns for default weighting
                weight: 1.0 // Default weight for prompt lemmas
              }))
            ];
            
            const tag = computeAspectTag(combinedTokens, aspects, { 
              emb: embMap, 
              weights, 
              rawTextForGuard: phrase,
              winkNLP: winkNLPInstance,
              posWeightedTokens: combinedPosWeightedTokens
            });
            
            phraseResults.push({
              phrase,
              tokens,
              aspect: tag.best,
              confidence: tag.conf,
              score: tag.ranked.find(r => r.id === tag.best)?.score || 0,
              ranked: tag.ranked
            });
          }
        }
        
        // Set combined tokens for display
        mockResponseNode.lemmas = allTokens;
        const posPattern = allTokens.map(() => 'X').join('-');
        mockResponseNode.posPattern = posPattern;
        setLemmaTokensUsed(allTokens);
        
        // Aggregate phrase results to determine single winning aspect
        if (phraseResults.length > 0) {
          // Sum scores across all phrases for each aspect
          const aspectTotals: { [key: string]: number } = {};
          phraseResults.forEach(result => {
            result.ranked.forEach(ranked => {
              aspectTotals[ranked.id] = (aspectTotals[ranked.id] || 0) + ranked.score;
            });
          });
          
          // Find the aspect with highest total score
          const bestAspect = Object.entries(aspectTotals)
            .sort(([,a], [,b]) => b - a)[0][0];
          
          // Calculate overall confidence based on phrase agreement
          const agreeingPhrases = phraseResults.filter(p => p.aspect === bestAspect);
          const overallConfidence = agreeingPhrases.length / phraseResults.length;
          
          // Create ranked results from aggregated scores
          const ranked = Object.entries(aspectTotals)
            .map(([id, score]) => ({ id, score }))
            .sort((a, b) => b.score - a.score);
          
          setResult({
            bestId: bestAspect,
            confidence: overallConfidence,
            ranked: ranked,
          });
          
          // Store phrase results for UI display
          setPhraseResults(phraseResults);
        }
      }
      
      setLastResponse(mockResponseNode);
      
      // Use the response text as the test phrase for aspect analysis
      setTestText(responseTextTrimmed);
      
    } catch (error) {
      alert(`Failed to process response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmittingResponse(false);
    }
  };

  async function onGuess() {
    if (!selectedTopic) {
      alert("Please choose a topic first.");
      return;
    }
    if (!lemmaFn) {
      alert("winkNLP not available yet. If your app exposes window.appLemma or window.nlp, this tool will use it automatically.");
      return;
    }
    // 1) Lemmatize using the same analyze function as the ingester
    const norm = await analyze(testText || "");
    const tokens = norm.tokens.map(token => token.lemma.toLowerCase());
    setLemmaTokensUsed(tokens);
    
    // Create POS-weighted tokens for enhanced aspect scoring
    const posWeightedTokens = norm.tokens.map(token => ({
      lemma: token.lemma.toLowerCase(),
      pos: token.pos,
      weight: getGrammaticalWeight(token.pos)
    }));
    
    // 2) Compute the tag exactly as the pipeline will (read-only)
    // Pass the winkNLP instance for consistent lemmatization
    const tag = computeAspectTag(tokens, aspects, { 
      emb: embMap, 
      weights, 
      rawTextForGuard: testText,
      winkNLP: winkNLPInstance,  // Pass the app's winkNLP instance for consistent lemmatization
      posWeightedTokens: posWeightedTokens
    });
    setResult({
      bestId: tag.best,
      confidence: tag.conf,
      ranked: tag.ranked,
    });
  }

  async function onChooseEmbFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const { map, dim } = await loadEmbeddingsFromFile(f);
      setEmbMap(map);
      setEmbDim(dim);
      setEmbCount(map.size);
      // expose to console for quick checks
      if (typeof window !== 'undefined') {
        (window as any).__emb = map;
        (window as any).__embSize = map.size;
        (window as any).__embHas = (w: string) => map.has((w || '').toLowerCase());
        (window as any).__embVec = (w: string) => map.get((w || '').toLowerCase());
        console.log('[AspectTester] Embeddings exposed on window: __emb, __embHas, __embVec, __embSize');
      }
    } catch (error) {
      alert(`Failed to load embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  function loadTinyExample() {
    // very tiny demo set; replace with a real GloVe file for better results
    const tiny = {
      life: [0.11, 0.08, 0.02, 0.07],
      bowl: [0.01, -0.03, 0.09, 0.02],
      cherry: [0.02, 0.05, 0.11, -0.02],
      fruit: [0.03, 0.05, 0.12, -0.01],
      dish: [0.01, -0.02, 0.08, 0.03],
      game: [0.10, 0.07, 0.01, 0.08],
      existence: [0.12, 0.06, 0.02, 0.09],
      vessel: [0, -0.03, 0.07, 0.03],
      stonefruit: [0.02, 0.04, 0.11, -0.02],
      living: [0.11, 0.07, 0.03, 0.06],
    };
    const { map, dim } = loadEmbeddingsFromString(JSON.stringify(tiny));
    setEmbMap(map);
    setEmbDim(dim);
    setEmbCount(map.size);
    if (typeof window !== 'undefined') {
      (window as any).__emb = map;
      (window as any).__embSize = map.size;
      (window as any).__embHas = (w: string) => map.has((w || '').toLowerCase());
      (window as any).__embVec = (w: string) => map.get((w || '').toLowerCase());
      console.log('[AspectTester] Demo embeddings exposed on window.');
    }
  }

  // Keep console helpers synced if embeddings change elsewhere
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (embMap) {
      (window as any).__emb = embMap;
      (window as any).__embSize = embMap.size;
      (window as any).__embHas = (w: string) => embMap.has((w || '').toLowerCase());
      (window as any).__embVec = (w: string) => embMap.get((w || '').toLowerCase());
    } else {
      delete (window as any).__emb;
      delete (window as any).__embHas;
      delete (window as any).__embVec;
      delete (window as any).__embSize;
    }
  }, [embMap]);

  // Expose selected topic lemmas for quick checks
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__topicLemmas = selectedTopic?.lemmas ?? [];
    }
  }, [selectedTopic]);

  return (
    <div className="w-full p-4 border rounded-xl bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Aspect Tester (read-only)</h2>
        <span className="text-xs text-gray-500">Does not save or change your graph</span>
      </div>

      {/* Topic selection using unified TopicChip */}
      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-800 mb-2">Topic Selection</label>
        <TopicChip graph={graph} />
        {selectedTopic ? (
          <div className="mt-3">
            <div className="text-xs text-gray-600 mb-2">Sub-topics the tool will try to match:</div>
            <div className="flex flex-wrap gap-2">
              {((selectedTopic.lemmas ?? [])
                .map(normalizeLemma)
                .filter(l => l && !isStopWord(l)))
                .map((l) => (
                  <span key={l} className="text-xs bg-gray-100 text-gray-800 rounded-full px-2 py-1 border">{l}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-gray-500">
            Start a topic session to begin testing aspect disambiguation.
          </div>
        )}
      </div>

      {/* Embeddings loader */}
      <div className="mt-6 border rounded-md p-3">
        <div className="text-sm font-medium mb-2">Related-word knowledge (optional)</div>
        <p className="text-xs text-gray-600">
          Load a small GloVe file to improve the guesses. You can use a JSON map {"{word:[...]}"}
          or a standard GloVe .txt file. If you skip this, the tool still works using exact words only.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".txt,.json" onChange={onChooseEmbFile} />
          <button
            className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 border"
            onClick={loadTinyExample}
            type="button"
            title="Loads a tiny built-in example just for demo"
          >
            Load tiny demo set
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-700">
          {embMap
            ? <>Loaded <b>{embCount.toLocaleString()}</b> words (dim {embDim}). Using budgeted sampling for performance.</>
            : <>No embeddings loaded.</>}
        </div>
      </div>

      {/* Prompt Generation and Response */}
      {selectedTopic && (
        <div className="mt-6 border rounded-md p-3">
          <div className="text-sm font-medium mb-2">Generate Enhanced Prompt & Test Response (Read-Only)</div>
          <p className="text-xs text-gray-600 mb-3">
            Generate prompts using the full PromptEngine capabilities - all phrases, words, chunks, and templates from your active context. 
            Test how responses would be processed for sub-topic disambiguation. 
            <strong> No data is saved to the graph - this is purely for testing.</strong>
          </p>
          
          <div className="space-y-3">
            {/* Generate Prompt Button */}
            <div>
                <button
                  type="button"
                  className="px-3 py-1 text-sm rounded bg-green-600 text-white hover:bg-green-700"
                  onClick={generatePrompt}
                  disabled={ctx.phrases.length === 0 && ctx.words.length === 0 && ctx.chunks.length === 0}
                  title={ctx.phrases.length === 0 && ctx.words.length === 0 && ctx.chunks.length === 0 ? "No content available for this topic" : "Generate enhanced prompt using full context (not saved)"}
                >
                  Generate Enhanced Prompt
                </button>
              {ctx.phrases.length === 0 && ctx.words.length === 0 && ctx.chunks.length === 0 && (
                <span className="ml-2 text-xs text-gray-500">(No content available)</span>
              )}
            </div>

            {/* Current Prompt Display */}
            {currentPrompt && (
              <div className="bg-blue-50 p-3 rounded border">
                <div className="text-sm font-medium text-blue-800 mb-1">Generated Prompt:</div>
                <div className="text-sm text-blue-700">{currentPrompt.templateText}</div>
                <div className="text-xs text-blue-600 mt-1">
                  Template: {currentPrompt.templateId} • Created: {new Date(currentPrompt.createdAt).toLocaleTimeString()}
                </div>
                <div className="text-xs text-blue-500 mt-1">
                  Generated using: {ctx.phrases.length} phrases, {ctx.words.length} words, {ctx.chunks.length} chunks
                </div>
                <div className="text-xs text-blue-500 mt-1">
                  Prompt lemmas: {promptLemmas.join(", ") || "none"}
                </div>
              </div>
            )}

            {/* Response Input */}
            {currentPrompt && (
              <div>
                <label className="block text-xs text-gray-700 mb-1">Your Response:</label>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm h-20"
                  placeholder="Enter your response to the prompt..."
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                />
                <div className="mt-2">
                  <button
                    type="button"
                    className="px-3 py-1 text-sm rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                    onClick={handleResponseSubmit}
                    disabled={!responseText.trim() || isSubmittingResponse}
                  >
                    {isSubmittingResponse ? "Processing..." : "Test Response (Not Saved)"}
                  </button>
                </div>
              </div>
            )}

            {/* Last Response Display */}
            {lastResponse && (
              <div className="bg-purple-50 p-3 rounded border">
                <div className="text-sm font-medium text-purple-800 mb-1">Last Response:</div>
                <div className="text-sm text-purple-700">{lastResponse.text}</div>
                <div className="text-xs text-purple-600 mt-1">
                  POS Pattern: {lastResponse.posPattern} • Lemmas: {lastResponse.lemmas.join(", ")}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-md p-3">
          <div className="text-sm font-medium mb-1">How should the guesser behave?</div>
          <div className="mt-2 space-y-3">
            <div>
              <label className="block text-xs text-gray-700 mb-1">
                Prefer exact word matches
                <span className="ml-2 text-gray-500">({weights.exactWord.toFixed(2)})</span>
              </label>
              <input
                type="range" min={0} max={5} step={0.25}
                value={weights.exactWord}
                onChange={e => setWeights(w => ({ ...w, exactWord: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1">
                Use related words (if loaded)
                <span className="ml-2 text-gray-500">({weights.relatedWords.toFixed(2)})</span>
              </label>
              <input
                type="range" min={0} max={3} step={0.25}
                value={weights.relatedWords}
                onChange={e => setWeights(w => ({ ...w, relatedWords: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1">
                Consider overall similarity
                <span className="ml-2 text-gray-500">({weights.similarity.toFixed(2)})</span>
              </label>
              <input
                type="range" min={0} max={2} step={0.25}
                value={weights.similarity}
                onChange={e => setWeights(w => ({ ...w, similarity: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1">
                Related words per sub-topic
              </label>
              <input
                type="number" min={0} max={30}
                value={haloK}
                onChange={(e) => setHaloK(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                className="w-28 border rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1">
                How many dictionary words to consider (bigger is slower)
              </label>
              <input
                type="number" min={1000} max={400000} step={1000}
                value={neighborBudget}
                onChange={(e) => setNeighborBudget(Math.max(1000, Math.min(400000, Number(e.target.value) || 20000)))}
                className="w-36 border rounded px-2 py-1 text-sm"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={properGuard} onChange={e => setProperGuard(e.target.checked)} />
              Treat capitalized names differently (small adjustment)
            </label>
          </div>
        </div>

        <div className="border rounded-md p-3">
          <div className="text-sm font-medium mb-2">Test Phrase Analysis</div>
          <div className="text-xs text-gray-600 mb-2">
            This text is automatically populated from your responses above, or you can manually enter text to test.
          </div>
          <textarea
            className="w-full border rounded-md px-3 py-2 text-sm h-28"
            placeholder='e.g.,  "a board game", "stone fruit", "ceramic dish" (or will be auto-filled from responses)'
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
          />
          <div className="mt-2">
            <button
              type="button"
              className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => onGuess()}
              disabled={!selectedTopic}
              title={selectedTopic ? "Guess the best sub-topic" : "Choose a topic first"}
            >
              Analyze Sub-topic Match
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6">
        <div className="text-sm font-medium">Result</div>
            {!result ? (
              <div className="text-xs text-gray-500 mt-1">Enter a phrase and click "Guess sub-topic".</div>
            ) : (
              <div className="mt-2">
                <div className="text-sm">
                  Best match: <b>{result.bestId}</b>{" "}
                  <span className="text-xs text-gray-500">(confidence {(result.confidence * 100).toFixed(0)}%)</span>
                </div>
                {testText && (
                  <div className="mt-2 text-xs text-gray-600">
                    <div>Analyzed words: <span className="font-mono">{tokenizeToContentWords(testText).join(", ") || "none"}</span></div>
                  </div>
                )}
            <div className="mt-2 space-y-1">
              {result.ranked.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <div className="w-28 text-gray-700">{r.id}</div>
                  <div className="flex-1 h-2 bg-gray-100 rounded">
                    <div
                      className="h-2 bg-blue-500 rounded"
                      style={{ width: `${Math.max(0, Math.min(100, r.score * 20))}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-gray-500">{r.score.toFixed(2)}</div>
                </div>
              ))}
            </div>
            
            {/* Phrase-level breakdown */}
            {phraseResults.length > 1 && (
              <div className="mt-4">
                <div className="text-xs font-medium mb-2">Phrase Analysis:</div>
                <div className="space-y-2">
                  {phraseResults.map((phraseResult, index) => (
                    <div key={index} className={`p-2 rounded text-xs ${
                      phraseResult.aspect === result.bestId ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
                    }`}>
                      <div className="font-medium mb-1">
                        Phrase {index + 1}: "{phraseResult.phrase}"
                      </div>
                      <div className="text-gray-600">
                        → <span className="font-medium">{phraseResult.aspect}</span> 
                        <span className="text-gray-500"> (score: {phraseResult.score.toFixed(2)}, confidence: {(phraseResult.confidence * 100).toFixed(0)}%)</span>
                      </div>
                      <div className="text-gray-500 mt-1">
                        Tokens: {phraseResult.tokens.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Exact tag JSON the pipeline would write */}
            <div className="mt-4">
              <div className="text-xs font-medium mb-1">Edge tag (exact JSON):</div>
              <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
{`{
  "best": "${result.bestId}",
  "conf": ${result.confidence.toFixed(4)},
  "ranked": ${JSON.stringify(result.ranked)}
}`}
              </pre>
            </div>
            {/* Show what lemma tokens were used + which engine produced them */}
            <div className="mt-3 text-xs text-gray-600">
              Lemmatizer: <b>{lemmaEngineLabel}</b>
            </div>
            <div className="mt-1">
              <div className="text-xs text-gray-600">Lemma tokens used:</div>
              <div className="text-[11px] text-gray-800 bg-gray-50 border rounded p-2 overflow-auto">
                {JSON.stringify(lemmaTokensUsed ?? [], null, 0)}
              </div>
            </div>
            {aspects.length ? (
              <div className="mt-4">
                <div className="text-xs text-gray-600">Related words used for each sub-topic (if embeddings loaded):</div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                  {aspects.map(a => (
                    <div key={a.id} className="border rounded-md p-2">
                      <div className="text-xs font-medium mb-1">{a.lemma}</div>
                      <div className="text-[11px] text-gray-700">{(a.halo || []).slice(0, 12).join(", ") || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
