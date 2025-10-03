import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import type { PhraseNode, WordNode, PhraseChunk, ContextFrame } from '../types/index.js';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext.js';
import { retrievalEngine } from '../lib/retrieve.js';
import { gloveService } from '../lib/gloveEmbeddings.js';

interface NodePoolConfig {
  methods: {
    SEMANTIC_SIMILARITY: { enabled: boolean; maxResults: number; minOverlap: number };
    LEXICAL_COOCCURRENCE: { enabled: boolean; maxResults: number; minSharedLemmas: number };
    POS_PATTERN_CLUSTERING: { enabled: boolean; maxResults: number; minSimilarity: number };
    SESSION_HISTORY: { enabled: boolean; maxResults: number; timeWindow: number };
    POLYSEMY_NETWORKS: { enabled: boolean; maxResults: number };
    GLOVE_NEIGHBORHOOD: {
      enabled: boolean; maxResults: number; k: number; minSimilarity: number;
      // 🔧 Fine-tuning controls
      scoreMode: 'cosine' | 'hybrid';
      useStopFilter: boolean;
      l2Normalize: boolean;
      center: boolean;           // subtract centroid to reduce hubness
      sifA: number;              // Smooth Inverse Frequency parameter (≈1e-3)
      useIDF: boolean;
      idfFloor: number;          // clamp IDF weights (avoid extremes)
      idfCeil: number;
      alpha: number;             // weight for cosine
      beta: number;              // weight for lexical overlap
      gamma: number;             // weight for POS pattern similarity
      posWeights: { NOUN: number; VERB: number; ADJ: number; ADV: number; OTHER: number };
    };
    WORDNET_RELATIONS: { enabled: boolean; maxResults: number; relations: string[] };
    TEMPORAL_PROXIMITY: { enabled: boolean; maxResults: number; timeWindow: number };
    CHUNK_COOCCURRENCE: { enabled: boolean; maxResults: number };
  };
  globalLimits: {
    maxTotalPhrases: number;
    maxTotalWords: number;
    maxTotalChunks: number;
  };
}

interface ScoredNode {
  node: PhraseNode | WordNode | PhraseChunk;
  score: number;
  method: string;
  confidence: number;
}

interface ActiveNodesToolProps {
  graph: SemanticGraphLite;
}

export default function ActiveNodesTool({ graph }: ActiveNodesToolProps) {
  const { ctx, contextFrame } = useActiveNodesWithGraph(graph);
  const [config, setConfig] = useState<NodePoolConfig>({
    methods: {
      SEMANTIC_SIMILARITY: { enabled: true, maxResults: 20, minOverlap: 0.1 },
      LEXICAL_COOCCURRENCE: { enabled: true, maxResults: 15, minSharedLemmas: 1 },
      POS_PATTERN_CLUSTERING: { enabled: true, maxResults: 10, minSimilarity: 0.3 },
      SESSION_HISTORY: { enabled: false, maxResults: 10, timeWindow: 24 },
      POLYSEMY_NETWORKS: { enabled: true, maxResults: 8 },
      GLOVE_NEIGHBORHOOD: {
        enabled: false, maxResults: 10, k: 8, minSimilarity: 0.4,
        scoreMode: 'hybrid',
        useStopFilter: true,
        l2Normalize: true,
        center: true,
        sifA: 1e-3,
        useIDF: true,
        idfFloor: 0.5,
        idfCeil: 3.0,
        alpha: 0.7,
        beta: 0.2,
        gamma: 0.1,
        posWeights: { NOUN: 1.0, VERB: 1.0, ADJ: 0.7, ADV: 0.5, OTHER: 1.0 }
      },
      WORDNET_RELATIONS: { enabled: false, maxResults: 8, relations: ['synonyms', 'hypernyms'] },
      TEMPORAL_PROXIMITY: { enabled: false, maxResults: 10, timeWindow: 24 },
      CHUNK_COOCCURRENCE: { enabled: true, maxResults: 12 },
    },
    globalLimits: {
      maxTotalPhrases: 50,
      maxTotalWords: 100,
      maxTotalChunks: 30,
    }
  });

  const [expandedMethods, setExpandedMethods] = useState<Set<string>>(new Set(['SEMANTIC_SIMILARITY']));

  // Settings persistence
  const SETTINGS_KEY = 'activeNodesTool_settings';
  
  const saveSettings = useCallback(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
      console.log('[ActiveNodesTool] Settings saved successfully');
    } catch (error) {
      console.error('[ActiveNodesTool] Failed to save settings:', error);
    }
  }, [config]);

  const loadSettings = useCallback(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsedConfig = JSON.parse(saved) as NodePoolConfig;
        setConfig(parsedConfig);
        console.log('[ActiveNodesTool] Settings loaded successfully');
      }
    } catch (error) {
      console.error('[ActiveNodesTool] Failed to load settings:', error);
    }
  }, []);

  // Load saved settings on component mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Initialize GloVe embeddings
  useEffect(() => {
    const initializeGloVe = async () => {
      try {
        await gloveService.loadModel('/glove.6B.50d.txt');
        console.log('[ActiveNodesTool] GloVe embeddings loaded successfully');
      } catch (error) {
        console.warn('[ActiveNodesTool] Failed to load GloVe embeddings:', error);
        console.warn('[ActiveNodesTool] Semantic Neighborhood will be disabled until GloVe loads');
      }
    };
    
    initializeGloVe();
  }, []);

  // ---- Helpers added for robustness/consistency across methods ----
  const normalizeLemma = (s?: string) => (s ? s.toLowerCase().trim() : '');
  const toLemmaSet = (arr?: string[]) => {
    if (!arr || arr.length === 0) return new Set<string>();
    const cleaned = arr.map(normalizeLemma).filter(Boolean);
    return new Set<string>(cleaned);
  };

  // Precompute helpers for GloVe method (IDF + lemma→POS map) - moved to top level
  const lemmaDocFreq = useMemo(() => {
    if (!config.methods.GLOVE_NEIGHBORHOOD.useIDF) return new Map<string, number>();
    const df = new Map<string, number>();
    const phrases = graph.getNodesByType('PHRASE') as PhraseNode[];
    const N = Math.max(phrases.length, 1);
    for (const p of phrases) {
      const set = new Set((p.lemmas || []).map(normalizeLemma).filter(Boolean));
      for (const l of set) df.set(l, (df.get(l) || 0) + 1);
    }
    // store N as df.get('__N__')
    df.set('__N__', N);
    return df;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, config.methods.GLOVE_NEIGHBORHOOD.useIDF]);

  const lemmaPOS = useMemo(() => {
    const map = new Map<string, string>(); // lemma -> coarse POS
    const words = (graph.getNodesByType('WORD') as WordNode[]) || [];
    for (const w of words) {
      const lem = normalizeLemma((w as any)?.lemma || (w as any)?.text);
      if (!lem) continue;
      const posPot = (w as any)?.posPotential || [];
      let coarse = 'OTHER';
      if (posPot.includes('NOUN') || posPot.includes('PROPN')) coarse = 'NOUN';
      else if (posPot.includes('VERB')) coarse = 'VERB';
      else if (posPot.includes('ADJ')) coarse = 'ADJ';
      else if (posPot.includes('ADV')) coarse = 'ADV';
      if (!map.has(lem)) map.set(lem, coarse);
    }
    return map;
  }, [graph]);

  // Helper function for pattern similarity calculation
  const calculatePatternSimilarity = (pattern1: string, pattern2: string): number => {
    if (!pattern1 || !pattern2) return 0;
    const parts1 = pattern1.split('-');
    const parts2 = pattern2.split('-');
    const intersection = parts1.filter(p => parts2.includes(p));
    return intersection.length / Math.max(parts1.length, parts2.length);
  };

  // Vector operations for advanced GloVe processing
  type Vec = Float32Array;
  const vecDim = 50; // assuming GloVe 6B.50d
  const newVec = () => new Float32Array(vecDim);
  const addScaled = (out: Vec, v: Vec, w: number) => { for (let i=0;i<vecDim;i++) out[i]+=v[i]*w; };
  const l2 = (v: Vec) => {
    let s=0; for (let i=0;i<vecDim;i++) s+=v[i]*v[i];
    const n = Math.sqrt(Math.max(s, 1e-12));
    for (let i=0;i<vecDim;i++) v[i]/=n;
    return v;
  };
  const sub = (a: Vec, b: Vec) => { for (let i=0;i<vecDim;i++) a[i]-=b[i]; return a; };
  const cosine = (a: Vec, b: Vec) => {
    let dot=0, na=0, nb=0;
    for (let i=0;i<vecDim;i++){ const ai=a[i], bi=b[i]; dot+=ai*bi; na+=ai*ai; nb+=bi*bi; }
    return dot / (Math.sqrt(Math.max(na,1e-12))*Math.sqrt(Math.max(nb,1e-12)));
  };
  // Try multiple common getters to avoid touching glove service code
  const getWordVector = (lemma: string): Vec | null => {
    const svc: any = gloveService as any;
    try {
      if (svc.getVector) return svc.getVector(lemma) as Vec | null;
      if (svc.getWordVector) return svc.getWordVector(lemma) as Vec | null;
      if (svc.vector) return svc.vector(lemma) as Vec | null;
      if (svc.lookup) return svc.lookup(lemma) as Vec | null;
    } catch {}
    return null;
  };

  // Build a stopword set from known, non-invasive sources; fallback if none exist.
  const getGlobalStopWords = (): Set<string> => {
    try {
      const fromCtx = (ctx as any)?.stopWords as string[] | undefined;
      if (Array.isArray(fromCtx) && fromCtx.length) {
        return new Set(fromCtx.map(w => w.toLowerCase()));
      }
    } catch {}

    try {
      const fromGraph = (graph as any)?.getStopWords?.() as string[] | undefined;
      if (Array.isArray(fromGraph) && fromGraph.length) {
        return new Set(fromGraph.map(w => w.toLowerCase()));
      }
    } catch {}

    try {
      const fromWin = (typeof window !== 'undefined' && (window as any).__STOP_WORDS__) as string[] | undefined;
      if (Array.isArray(fromWin) && fromWin.length) {
        return new Set(fromWin.map(w => w.toLowerCase()));
      }
    } catch {}

    // Conservative built-in fallback (kept short to avoid over-filtering)
    return new Set([
      'the','a','an','and','or','but','if','then','else','for','of','on','in','to','with','by','from','as','at',
      'be','is','are','was','were','been','being',
      'do','does','did','doing',
      'have','has','had','having',
      'that','this','these','those','it','its'
    ]);
  };

  const isStop = (lemma?: string, stopSet?: Set<string>) => {
    const l = normalizeLemma(lemma);
    return !!l && !!stopSet && stopSet.has(l);
  };

  const toContentLemmaSet = (arr: string[] | undefined, stopSet: Set<string>) => {
    const base = toLemmaSet(arr);
    if (base.size === 0) return base;
    const filtered = Array.from(base).filter(l => !stopSet.has(l));
    return new Set(filtered);
  };
  const sortScored = (a: ScoredNode, b: ScoredNode) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const at = (a.node as any)?.text ?? '';
    const bt = (b.node as any)?.text ?? '';
    return at.localeCompare(bt);
  };

  // Helper: compute overlap (topic lemmas ∩ phrase lemmas), stopword-aware
  function computeSharedLemmasForNode(
    node: { lemmas?: string[] },
    topicLemmas: Set<string>,
    STOP: Set<string>,
  ): string[] {
    const all = new Set<string>((node.lemmas ?? []).map(l => (l || '').toLowerCase()));
    const filtered = Array.from(all).filter(l => !STOP.has(l));
    return filtered.filter(l => topicLemmas.has(l));
  }

  // Compute expanded active nodes based on configuration
  const expandedNodes = useMemo(() => {
    if (!contextFrame?.topicId) {
      return {
        phrases: [],
        words: [],
        chunks: [],
        methodBreakdown: {}
      };
    }

    // Resolve stop words once per computation
    const STOP = getGlobalStopWords();
    const methodBreakdown: Record<string, ScoredNode[]> = {};
    const allPhrases = new Map<string, ScoredNode>();
    const allWords = new Map<string, ScoredNode>();
    const allChunks = new Map<string, ScoredNode>();
    
    // Track already added items to prevent duplicates
    const addedPhraseIds = new Set<string>();
    const addedWordIds = new Set<string>();
    const addedChunkIds = new Set<string>();

    // Helper functions for first-come-first-served exclusion
    const addPhraseIfNew = (scoredNode: ScoredNode): boolean => {
      if (addedPhraseIds.has(scoredNode.node.id)) {
        return false; // Already added, skip
      }
      addedPhraseIds.add(scoredNode.node.id);
      allPhrases.set(scoredNode.node.id, scoredNode);
      return true; // Successfully added
    };

    const addWordIfNew = (word: WordNode): boolean => {
      if (addedWordIds.has(word.id)) {
        return false;
      }
      addedWordIds.add(word.id);
      allWords.set(word.id, { node: word, score: 0, method: 'DERIVED_FROM_PHRASE', confidence: 0 });
      return true;
    };

    const addChunkIfNew = (chunk: PhraseChunk): boolean => {
      if (addedChunkIds.has(chunk.id)) {
        return false;
      }
      addedChunkIds.add(chunk.id);
      allChunks.set(chunk.id, { node: chunk, score: chunk.score, method: 'DERIVED_FROM_PHRASE', confidence: 0 });
      return true;
    };

    // Get topic-related phrases (existing ctx.phrases)
    const topicPhrases = ctx.phrases || [];
    const topicPhraseIds = new Set(topicPhrases.map(p => p.id));
    
    console.log('[ActiveNodesTool] Context debug:', {
      contextFrame: contextFrame ? {
        topicId: contextFrame.topicId,
        topicText: contextFrame.topicText,
        sessionId: contextFrame.sessionId
      } : null,
      ctx: {
        phrases: ctx.phrases?.length || 0,
        words: ctx.words?.length || 0,
        chunks: ctx.chunks?.length || 0
      }
    });
    // Build topic lemma set from contextual phrases; if none yet, fall back to topicText tokens
    // Force topic lemmas to come only from the current topic line (not all session phrases)
    const topicLemmasFromPhrases = new Set<string>();
    const topicTextFallbackLemmas = (() => {
      if (topicLemmasFromPhrases.size > 0) return new Set<string>();
      const raw = (contextFrame.topicText || '')
        .split(/[^a-zA-Z0-9]+/)
        .map(s => s.toLowerCase().trim())
        .filter(Boolean)
        .filter(t => !STOP.has(t));
      return new Set<string>(raw);
    })();
    const topicLemmas = topicLemmasFromPhrases.size > 0 ? topicLemmasFromPhrases : topicTextFallbackLemmas;
    
    console.log('[ActiveNodesTool] Topic lemmas debug:', {
      topicLemmasFromPhrases: Array.from(topicLemmasFromPhrases),
      topicTextFallbackLemmas: Array.from(topicTextFallbackLemmas),
      finalTopicLemmas: Array.from(topicLemmas),
      topicText: contextFrame.topicText
    });

    // Method 1: Semantic Similarity (existing related phrases system)
    if (config.methods.SEMANTIC_SIMILARITY.enabled) {
      const semanticResults: ScoredNode[] = [];
      topicPhrases.forEach(phrase => {
        try {
          const result = retrievalEngine.surfaceRelatedPhrases(phrase.id, graph, {
            maxResults: config.methods.SEMANTIC_SIMILARITY.maxResults,
            minOverlap: config.methods.SEMANTIC_SIMILARITY.minOverlap
          });
          result.relatedPhrases.forEach(scored => {
            if (!topicPhraseIds.has(scored.phrase.id)) {
              const scoredNode: any = {
                node: scored.phrase,
                score: scored.score,
                method: 'SEMANTIC_SIMILARITY',
                confidence: scored.overlapScore,
                meta: { sharedLemmas: computeSharedLemmasForNode(scored.phrase, topicLemmas, STOP) }
              };
              if (addPhraseIfNew(scoredNode)) {
                semanticResults.push(scoredNode);
              }
            }
          });
        } catch (error) {
          console.warn('Semantic similarity error:', error);
        }
      });
      methodBreakdown.SEMANTIC_SIMILARITY = semanticResults.sort(sortScored).slice(0, config.methods.SEMANTIC_SIMILARITY.maxResults);
    }

    // Method 2: Lexical Co-occurrence - robust set-based scoring & no premature filtering
    if (config.methods.LEXICAL_COOCCURRENCE.enabled) {
      const lexicalResults: ScoredNode[] = [];
      if (topicLemmas.size > 0) {
        // 🔒 Coerce and clamp minSharedLemmas safely (avoid ""/NaN causing fallback to 1)
        const rawMin = (config.methods.LEXICAL_COOCCURRENCE as any).minSharedLemmas;
        const coerced = Number(rawMin);
        const minShared = Number.isFinite(coerced) ? Math.max(1, Math.floor(coerced)) : 1;
        
        // Collect all candidates across ALL topic lemmas (no early allPhrases filtering)
        const candidatePhrases = new Map<string, PhraseNode>();
        topicLemmas.forEach(lemma => {
          if (isStop(lemma, STOP)) return; // skip glue/stop lemmas entirely
          const related = graph.getPhrasesByWordLemma?.(lemma) || [];
          related.forEach((phrase: PhraseNode) => {
            if (!phrase || !phrase.id) return;
            if (!topicPhraseIds.has(phrase.id)) {
              candidatePhrases.set(phrase.id, phrase);
            }
          });
        });

        // Score by set overlap coverage (both directions)
        candidatePhrases.forEach((phrase) => {
          // Remove stop words from candidate before scoring
          const phraseLemmaSetAll = toLemmaSet(phrase.lemmas || []);
          const phraseLemmaSet = new Set(Array.from(phraseLemmaSetAll).filter(l => !STOP.has(l)));
          if (phraseLemmaSet.size === 0) return;
          const sharedLemmasArr = Array.from(phraseLemmaSet).filter(l => topicLemmas.has(l));
          const sharedCount = sharedLemmasArr.length;
          if (sharedCount >= minShared) {
            const score = sharedCount / Math.max(phraseLemmaSet.size, 1); // coverage of candidate by topic
            const confidence = sharedCount / Math.max(topicLemmas.size, 1); // coverage of topic by candidate
            // Attach shared lemmas to the result so the table can show them
            const scoredNode: any = {
              node: phrase,
              score,
              method: 'LEXICAL_COOCCURRENCE',
              confidence,
              meta: { sharedLemmas: sharedLemmasArr }
            };
            if (addPhraseIfNew(scoredNode)) {
              lexicalResults.push(scoredNode);
            }
          } else {
            // Optional: dev trace to verify gating behavior
            // console.debug('[LEXICAL_COOCCURRENCE] filtered', { phrase: phrase.text, sharedCount, minShared });
          }
        });
      }
      methodBreakdown.LEXICAL_COOCCURRENCE = lexicalResults.sort(sortScored).slice(0, config.methods.LEXICAL_COOCCURRENCE.maxResults);
    }

    // Method 3: POS Pattern Clustering - sort + guard
    if (config.methods.POS_PATTERN_CLUSTERING.enabled) {
      const patternResults: ScoredNode[] = [];
      const topicPatterns = topicPhrases.map(p => p.posPattern).filter(Boolean);
      
      const allPhrasesInGraph = graph.getNodesByType('PHRASE') as PhraseNode[];
      allPhrasesInGraph.forEach(phrase => {
        if (!topicPhraseIds.has(phrase.id) && phrase.posPattern) {
          const maxSimilarity = Math.max(...topicPatterns.map(topicPattern => 
            calculatePatternSimilarity(topicPattern, phrase.posPattern!)
          ));
          if (maxSimilarity >= config.methods.POS_PATTERN_CLUSTERING.minSimilarity) {
            const scoredNode: any = {
              node: phrase,
              score: maxSimilarity,
              method: 'POS_PATTERN_CLUSTERING',
              confidence: maxSimilarity,
              meta: { sharedLemmas: computeSharedLemmasForNode(phrase, topicLemmas, STOP) }
            };
            if (addPhraseIfNew(scoredNode)) {
              patternResults.push(scoredNode);
            }
          }
        }
      });
      methodBreakdown.POS_PATTERN_CLUSTERING = patternResults.sort(sortScored).slice(0, config.methods.POS_PATTERN_CLUSTERING.maxResults);
    }

    // Method 4: Session History - respect timeWindow; score by recency; sort
    if (config.methods.SESSION_HISTORY.enabled) {
      const historyResults: ScoredNode[] = [];
      const currentSessionId = contextFrame.sessionId;
      const timeWindowMs = Math.max(1, config.methods.SESSION_HISTORY.timeWindow) * 60 * 60 * 1000;
      const refTime = contextFrame.startedAt;

      const edges = graph.getEdges().filter(e => e.type === 'CREATED_IN_SESSION' && e.to && e.from);
      const otherSessionEdges = edges.filter(e => e.to !== currentSessionId);

      const allPhrasesMap = new Map<string, PhraseNode>(
        (graph.getNodesByType('PHRASE') as PhraseNode[]).map(p => [p.id, p])
      );

      otherSessionEdges.forEach(edge => {
        const phrase = allPhrasesMap.get(edge.from as string);
        if (!phrase || topicPhraseIds.has(phrase.id)) return;
        const timeDiff = Math.abs((phrase.createdAt || 0) - refTime);
        if (timeDiff <= timeWindowMs) {
          const recencyScore = 1 - (timeDiff / timeWindowMs);
          const scoredNode: any = {
            node: phrase,
            score: recencyScore,
            method: 'SESSION_HISTORY',
            confidence: 0.3,
            meta: { sharedLemmas: computeSharedLemmasForNode(phrase, topicLemmas, STOP) }
          };
          if (addPhraseIfNew(scoredNode)) {
            historyResults.push(scoredNode);
          }
        }
      });
      methodBreakdown.SESSION_HISTORY = historyResults.sort(sortScored).slice(0, config.methods.SESSION_HISTORY.maxResults);
    }

    // Method 5: Polysemy Networks - use posPotential to detect polysemy; sort
    if (config.methods.POLYSEMY_NETWORKS.enabled) {
      const polysemyResults: ScoredNode[] = [];
      const topicWords = (ctx.words || []);
      const polysemousWords = topicWords.filter(w => {
        const lemma = normalizeLemma((w as any)?.lemma);
        const isPoly = (w as any)?.posPotential?.length > 1;
        return isPoly && !STOP.has(lemma);
      });
      
      polysemousWords.forEach(word => {
        const polysemyPhrases = graph.getPhrasesByWordLemma?.(normalizeLemma(word.lemma)) || [];
        polysemyPhrases.forEach((phrase: PhraseNode) => {
          if (!topicPhraseIds.has(phrase.id)) {
            const scoredNode: any = {
              node: phrase,
              score: 0.6, // Higher score for polysemy relevance
              method: 'POLYSEMY_NETWORKS',
              confidence: 0.4,
              meta: { sharedLemmas: computeSharedLemmasForNode(phrase, topicLemmas, STOP) }
            };
            if (addPhraseIfNew(scoredNode)) {
              polysemyResults.push(scoredNode);
            }
          }
        });
      });
      methodBreakdown.POLYSEMY_NETWORKS = polysemyResults.sort(sortScored).slice(0, config.methods.POLYSEMY_NETWORKS.maxResults);
    }

    // GloVe helper functions (useMemo hooks moved to top level)

    const computeIDF = (lemma: string) => {
      if (!config.methods.GLOVE_NEIGHBORHOOD.useIDF) return 1;
      const N = lemmaDocFreq.get('__N__') || 1;
      const df = lemmaDocFreq.get(lemma) || 0;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      return Math.min(Math.max(idf, config.methods.GLOVE_NEIGHBORHOOD.idfFloor), config.methods.GLOVE_NEIGHBORHOOD.idfCeil);
    };

    const posWeightFor = (lemma: string) => {
      const coarse = lemmaPOS.get(lemma) || 'OTHER';
      return (config.methods.GLOVE_NEIGHBORHOOD.posWeights as any)[coarse] ?? 1.0;
    };

    const embedFromLemmas = (lemmas: string[]): Vec | null => {
      const { useStopFilter, sifA, l2Normalize } = config.methods.GLOVE_NEIGHBORHOOD;
      const out = newVec();
      let wsum = 0;
      const N = Math.max((lemmaDocFreq.get('__N__') || 0), 1);
      for (const raw of lemmas) {
        const lemma = normalizeLemma(raw);
        if (!lemma) continue;
        if (useStopFilter && STOP.has(lemma)) continue;
        const v = getWordVector(lemma);
        if (!v) continue;
        // p(w) approx by df/N if available; else 0
        const df = lemmaDocFreq.get(lemma) || 0;
        const p = df > 0 ? (df / N) : 0;
        const sif = sifA > 0 ? (sifA / (sifA + p)) : 1;
        const idf = computeIDF(lemma);
        const pw = posWeightFor(lemma);
        const w = Math.max(0, sif * idf * pw);
        if (w <= 0) continue;
        addScaled(out, v, w);
        wsum += w;
      }
      if (wsum === 0) return null;
      for (let i=0;i<vecDim;i++) out[i] /= wsum;
      return l2Normalize ? l2(out) : out;
    };

    // Method 6: GloVe Neighborhood - semantic similarity using improved pooling + hybrid re-rank
    if (config.methods.GLOVE_NEIGHBORHOOD.enabled) {
      const gloveResults: ScoredNode[] = [];
      if (gloveService.getLoadedStatus() && topicLemmas.size > 0) {
        try {
          const allPhrasesInGraph = graph.getNodesByType('PHRASE') as PhraseNode[];
          const candidatePhrases = allPhrasesInGraph.filter(p => !topicPhraseIds.has(p.id));
          const topicVec = embedFromLemmas(Array.from(topicLemmas));
          if (topicVec) {
            // Build candidate vectors
            const candVecs: Array<{ phrase: PhraseNode; v: Vec | null; lex: number; pat: number }> = [];
            // Precompute topic pattern similarity source
            const topicPatterns = (ctx.phrases || []).map(p => p.posPattern).filter(Boolean) as string[];
            const topicLemmasArr = Array.from(topicLemmas);
            for (const phrase of candidatePhrases) {
              const lem = (phrase.lemmas || []).map(normalizeLemma).filter(Boolean);
              const v = embedFromLemmas(lem);
              // lexical overlap (content only)
              const candSet = new Set(lem.filter(l => !STOP.has(l)));
              const shared = topicLemmasArr.filter(l => candSet.has(l)).length;
              const union = new Set<string>([...topicLemmasArr, ...Array.from(candSet)]).size || 1;
              const lexOverlap = shared / union; // Jaccard-like
              // pattern similarity vs best topic pattern
              const patSim = phrase.posPattern && topicPatterns.length
                ? Math.max(...topicPatterns.map(tp => calculatePatternSimilarity(tp, phrase.posPattern!)))
                : 0;
              candVecs.push({ phrase, v, lex: lexOverlap, pat: patSim });
            }
            // Optional centering
            if (config.methods.GLOVE_NEIGHBORHOOD.center) {
              const centroid = newVec();
              let count = 1; // include topic
              addScaled(centroid, topicVec, 1);
              for (const c of candVecs) if (c.v) { addScaled(centroid, c.v, 1); count++; }
              for (let i=0;i<vecDim;i++) centroid[i]/=count;
              sub(topicVec, centroid);
              for (const c of candVecs) if (c.v) sub(c.v, centroid);
            }
            // Score
            const { alpha, beta, gamma, scoreMode, minSimilarity, k } = config.methods.GLOVE_NEIGHBORHOOD;
            const scored: Array<{ phrase: PhraseNode; score: number; cos: number; lex: number; pat: number }> = [];
            for (const c of candVecs) {
              if (!c.v) continue;
              const cos = cosine(topicVec, c.v);
              const final = scoreMode === 'cosine' ? cos : (alpha * cos + beta * c.lex + gamma * c.pat);
              if (final >= minSimilarity) {
                scored.push({ phrase: c.phrase, score: final, cos, lex: c.lex, pat: c.pat });
              }
            }
            scored.sort((a,b)=>b.score-a.score);
            const top = scored.slice(0, Math.min(k, scored.length));
            for (const s of top) {
              const sn: any = {
                node: s.phrase,
                score: s.score,
                method: 'GLOVE_NEIGHBORHOOD',
                confidence: Math.min(s.cos * 1.2, 1.0),
                meta: { sharedLemmas: computeSharedLemmasForNode(s.phrase, topicLemmas, STOP) }
              };
              if (addPhraseIfNew(sn)) {
                gloveResults.push(sn);
              }
            }
          }
        } catch (err) {
          console.warn('[ActiveNodesTool] GloVe neighborhood error:', err);
        }
      }
      methodBreakdown.GLOVE_NEIGHBORHOOD = gloveResults.sort(sortScored).slice(0, config.methods.GLOVE_NEIGHBORHOOD.maxResults);
    }

    // Method 7: WordNet Relations (placeholder - requires WordNet integration)
    if (config.methods.WORDNET_RELATIONS.enabled) {
      methodBreakdown.WORDNET_RELATIONS = []; // TODO: Implement when WordNet is integrated
    }

    // Method 8: Temporal Proximity - sort by proximity
    if (config.methods.TEMPORAL_PROXIMITY.enabled) {
      const temporalResults: ScoredNode[] = [];
      const timeWindowMs = config.methods.TEMPORAL_PROXIMITY.timeWindow * 60 * 60 * 1000;
      const sessionStartTime = contextFrame.startedAt;
      
      const allPhrasesInGraph = graph.getNodesByType('PHRASE') as PhraseNode[];
      allPhrasesInGraph.forEach(phrase => {
        if (!topicPhraseIds.has(phrase.id)) {
          const timeDiff = Math.abs(phrase.createdAt - sessionStartTime);
          if (timeDiff <= timeWindowMs) {
            const scoredNode: any = {
              node: phrase,
              score: 1 - (timeDiff / timeWindowMs), // Closer in time = higher score
              method: 'TEMPORAL_PROXIMITY',
              confidence: 0.3,
              meta: { sharedLemmas: computeSharedLemmasForNode(phrase, topicLemmas, STOP) }
            };
            if (addPhraseIfNew(scoredNode)) {
              temporalResults.push(scoredNode);
            }
          }
        }
      });
      methodBreakdown.TEMPORAL_PROXIMITY = temporalResults.sort(sortScored).slice(0, config.methods.TEMPORAL_PROXIMITY.maxResults);
    }


    // Method 10: Chunk Co-occurrence - guard zero division; sort
    if (config.methods.CHUNK_COOCCURRENCE.enabled) {
      const chunkResults: ScoredNode[] = [];
      const topicChunks = ctx.chunks || [];
      const topicChunkIds = new Set(topicChunks.map(c => c.id));
      
      const allPhrasesInGraph = graph.getNodesByType('PHRASE') as PhraseNode[];
      allPhrasesInGraph.forEach(phrase => {
        if (!topicPhraseIds.has(phrase.id)) {
          const pChunks = phrase.chunks || [];
          const denom = Math.max(pChunks.length, 1);
          const sharedChunks = pChunks.filter(c => topicChunkIds.has(c.id)).length;
          if (sharedChunks > 0 && topicChunks.length > 0) {
            const scoredNode: any = {
              node: phrase,
              score: sharedChunks / denom,
              method: 'CHUNK_COOCCURRENCE',
              confidence: sharedChunks / topicChunks.length,
              meta: { sharedLemmas: computeSharedLemmasForNode(phrase, topicLemmas, STOP) }
            };
            if (addPhraseIfNew(scoredNode)) {
              chunkResults.push(scoredNode);
            }
          }
        }
      });
      methodBreakdown.CHUNK_COOCCURRENCE = chunkResults.sort(sortScored).slice(0, config.methods.CHUNK_COOCCURRENCE.maxResults);
    }

    // Extract words and chunks from expanded phrases
    const expandedPhrases = Array.from(allPhrases.values()).map(s => s.node as PhraseNode);
    const expandedWords = new Map<string, WordNode>();
    const expandedChunks = new Map<string, PhraseChunk>();

    // Build lookup map once for efficiency
    const allWordsInGraph = (graph.getNodesByType('WORD') as WordNode[]) || [];
    const wordMap = new Map<string, WordNode>(allWordsInGraph.map(w => [w.id, w]));

    expandedPhrases.forEach(phrase => {
      // Add words
      (phrase.wordIds || []).forEach(wordId => {
        const word = wordMap.get(wordId);
        if (word) {
          addWordIfNew(word);
        }
      });
      
      // Add chunks
      (phrase.chunks || []).forEach(chunk => {
        addChunkIfNew(chunk);
      });
    });

    return {
      phrases: expandedPhrases.slice(0, config.globalLimits.maxTotalPhrases),
      words: Array.from(expandedWords.values()).slice(0, config.globalLimits.maxTotalWords),
      chunks: Array.from(expandedChunks.values()).slice(0, config.globalLimits.maxTotalChunks),
      methodBreakdown
    };
  }, [ctx, contextFrame, config, graph]);

  const updateConfig = useCallback((method: keyof NodePoolConfig['methods'], updates: any) => {
    setConfig(prev => ({
      ...prev,
      methods: {
        ...prev.methods,
        [method]: { ...prev.methods[method], ...updates }
      }
    }));
  }, []);

  const updateGlobalLimits = useCallback((updates: Partial<NodePoolConfig['globalLimits']>) => {
    setConfig(prev => ({
      ...prev,
      globalLimits: { ...prev.globalLimits, ...updates }
    }));
  }, []);

  const toggleMethodExpansion = useCallback((method: string) => {
    setExpandedMethods(prev => {
      const newSet = new Set(prev);
      if (newSet.has(method)) {
        newSet.delete(method);
      } else {
        newSet.add(method);
      }
      return newSet;
    });
  }, []);

  const organizeWordsByPOS = (words: WordNode[]) => {
    const organized = {
      nouns: [] as WordNode[],
      verbs: [] as WordNode[],
      adjectives: [] as WordNode[],
      adverbs: [] as WordNode[],
      multiPOS: [] as WordNode[],
    };

    words.forEach(word => {
      const potentialPOS = word.posPotential || [];
      
      if (potentialPOS.length > 1) {
        organized.multiPOS.push(word);
      } else {
        const pos = potentialPOS[0] || 'NOUN';
        switch (pos) {
          case 'NOUN':
          case 'PROPN':
            organized.nouns.push(word);
            break;
          case 'VERB':
            organized.verbs.push(word);
            break;
          case 'ADJ':
            organized.adjectives.push(word);
            break;
          case 'ADV':
            organized.adverbs.push(word);
            break;
          default:
            organized.nouns.push(word);
        }
      }
    });

    return organized;
  };

  if (!contextFrame) {
    return (
      <div className="p-6 bg-gray-50 rounded-lg">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Active Nodes Tool</h2>
        <div className="text-gray-600">No active topic session. Start a topic to use this tool.</div>
      </div>
    );
  }

  const organizedWords = organizeWordsByPOS(expandedNodes.words);

  return (
    <div className="p-6 bg-gray-50 rounded-lg">
      <h2 className="text-xl font-bold text-gray-800 mb-4">Active Nodes Tool</h2>
      <div className="text-sm text-gray-600 mb-4">
        Current Topic: <span className="font-medium">{contextFrame.topicText}</span>
      </div>

      {/* Configuration Panel */}
      <div className="mb-6 bg-white p-4 rounded-lg border">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Expansion Methods Configuration</h3>
          <button
            onClick={saveSettings}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Save Settings
          </button>
        </div>
        
        {/* Global Limits */}
        <div className="mb-4 p-3 bg-gray-50 rounded">
          <h4 className="font-medium mb-2">Global Limits</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Phrases
              </label>
              <input
                type="number"
                value={config.globalLimits.maxTotalPhrases}
                onChange={(e) => updateGlobalLimits({ maxTotalPhrases: parseInt(e.target.value) })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                min="1"
                max="200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Words
              </label>
              <input
                type="number"
                value={config.globalLimits.maxTotalWords}
                onChange={(e) => updateGlobalLimits({ maxTotalWords: parseInt(e.target.value) })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                min="1"
                max="500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Chunks
              </label>
              <input
                type="number"
                value={config.globalLimits.maxTotalChunks}
                onChange={(e) => updateGlobalLimits({ maxTotalChunks: parseInt(e.target.value) })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                min="1"
                max="100"
              />
            </div>
          </div>
        </div>

        {/* Method Controls */}
        <div className="space-y-3">
          {Object.entries(config.methods).map(([methodKey, methodConfig]) => {
            const methodNames: Record<string, { name: string; description: string }> = {
              SEMANTIC_SIMILARITY: { name: "Similar Meaning", description: "Find phrases with similar meanings using word overlap" },
              LEXICAL_COOCCURRENCE: { name: "Shared Words", description: "Find phrases that share words with your topic" },
              POS_PATTERN_CLUSTERING: { name: "Similar Structure", description: "Find phrases with similar grammatical patterns" },
              SESSION_HISTORY: { name: "Past Sessions", description: "Include phrases from previous topic sessions" },
              POLYSEMY_NETWORKS: { name: "Multiple Meanings", description: "Find phrases using words with multiple meanings" },
              GLOVE_NEIGHBORHOOD: { name: "Semantic Neighborhood", description: "Find semantically similar phrases using AI embeddings" },
              WORDNET_RELATIONS: { name: "Word Relationships", description: "Find phrases using related words (synonyms, etc.)" },
              TEMPORAL_PROXIMITY: { name: "Recent Activity", description: "Include recently created phrases" },
              CHUNK_COOCCURRENCE: { name: "Shared Phrases", description: "Find phrases that share meaningful phrase chunks" }
            };

            const methodInfo = methodNames[methodKey];
            const isExpanded = expandedMethods.has(methodKey);
            const resultCount = expandedNodes.methodBreakdown[methodKey]?.length || 0;

            return (
              <div key={methodKey} className="border border-gray-200 rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={methodConfig.enabled}
                      onChange={(e) => updateConfig(methodKey as keyof NodePoolConfig['methods'], { enabled: e.target.checked })}
                      className="rounded"
                    />
                    <div>
                      <div className="font-medium">{methodInfo.name}</div>
                      <div className="text-sm text-gray-600">{methodInfo.description}</div>
                      <div className="text-xs text-gray-500">Results: {resultCount}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleMethodExpansion(methodKey)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    {isExpanded ? 'Hide' : 'Show'} Settings
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Max Results
                        </label>
                        <input
                          type="number"
                          value={methodConfig.maxResults}
                          onChange={(e) => updateConfig(methodKey as keyof NodePoolConfig['methods'], { maxResults: parseInt(e.target.value) })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          min="1"
                          max="50"
                        />
                      </div>
                      
                      {/* Method-specific controls */}
                      {methodKey === 'SEMANTIC_SIMILARITY' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Min Word Overlap
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={methodConfig.minOverlap}
                            onChange={(e) => updateConfig(methodKey as keyof NodePoolConfig['methods'], { minOverlap: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            min="0"
                            max="1"
                          />
                        </div>
                      )}
                      
                      {methodKey === 'LEXICAL_COOCCURRENCE' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Min Shared Words
                          </label>
                          <input
                            type="number"
                            value={methodConfig.minSharedLemmas}
                            onChange={(e) => updateConfig(methodKey as keyof NodePoolConfig['methods'], { minSharedLemmas: parseInt(e.target.value) })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            min="1"
                            max="10"
                          />
                        </div>
                      )}
                      
                      {methodKey === 'POS_PATTERN_CLUSTERING' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Min Pattern Similarity
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={methodConfig.minSimilarity}
                            onChange={(e) => updateConfig(methodKey as keyof NodePoolConfig['methods'], { minSimilarity: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            min="0"
                            max="1"
                          />
                        </div>
                      )}
                      
                      {(methodKey === 'SESSION_HISTORY' || methodKey === 'TEMPORAL_PROXIMITY') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Time Window (hours)
                          </label>
                          <input
                            type="number"
                            value={methodConfig.timeWindow}
                            onChange={(e) => updateConfig(methodKey as keyof NodePoolConfig['methods'], { timeWindow: parseInt(e.target.value) })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            min="1"
                            max="168"
                          />
                        </div>
                      )}
                      
                      {methodKey === 'GLOVE_NEIGHBORHOOD' && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Neighborhood Size</label>
                              <input type="number" value={methodConfig.k}
                                onChange={(e)=>updateConfig(methodKey as any,{k:parseInt(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="1" max="50"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Similarity Threshold</label>
                              <input type="number" value={methodConfig.minSimilarity}
                                onChange={(e)=>updateConfig(methodKey as any,{minSimilarity:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0.0" max="1.0" step="0.05"/>
                              <div className="text-xs text-gray-500 mt-1">Higher = stricter (0.1 loose, 0.4 moderate, 0.7 strict)</div>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Score Mode</label>
                              <select
                                value={methodConfig.scoreMode}
                                onChange={(e)=>updateConfig(methodKey as any,{scoreMode:e.target.value})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option value="hybrid">Hybrid (cosine+lex+pattern)</option>
                                <option value="cosine">Cosine only</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">α Cosine</label>
                              <input type="number" step="0.05" value={methodConfig.alpha}
                                onChange={(e)=>updateConfig(methodKey as any,{alpha:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="1"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">β Lexical</label>
                              <input type="number" step="0.05" value={methodConfig.beta}
                                onChange={(e)=>updateConfig(methodKey as any,{beta:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="1"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">γ Pattern</label>
                              <input type="number" step="0.05" value={methodConfig.gamma}
                                onChange={(e)=>updateConfig(methodKey as any,{gamma:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="1"/>
                            </div>
                            <div className="flex items-end">
                              <label className="inline-flex items-center space-x-2">
                                <input type="checkbox" checked={methodConfig.useStopFilter}
                                  onChange={(e)=>updateConfig(methodKey as any,{useStopFilter:e.target.checked})}/>
                                <span className="text-sm">Exclude Stop Words</span>
                              </label>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">SIF (a)</label>
                              <input type="number" step="0.0001" value={methodConfig.sifA}
                                onChange={(e)=>updateConfig(methodKey as any,{sifA:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="0.01"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Use IDF</label>
                              <select value={String(methodConfig.useIDF)}
                                onChange={(e)=>updateConfig(methodKey as any,{useIDF:e.target.value==='true'})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">IDF Min</label>
                              <input type="number" step="0.1" value={methodConfig.idfFloor}
                                onChange={(e)=>updateConfig(methodKey as any,{idfFloor:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0.1" max="5"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">IDF Max</label>
                              <input type="number" step="0.1" value={methodConfig.idfCeil}
                                onChange={(e)=>updateConfig(methodKey as any,{idfCeil:parseFloat(e.target.value)})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0.5" max="10"/>
                            </div>
                          </div>

                          <div className="grid grid-cols-5 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">NOUN wt</label>
                              <input type="number" step="0.1" value={methodConfig.posWeights.NOUN}
                                onChange={(e)=>updateConfig(methodKey as any,{posWeights:{...methodConfig.posWeights, NOUN:parseFloat(e.target.value)}})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="2"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">VERB wt</label>
                              <input type="number" step="0.1" value={methodConfig.posWeights.VERB}
                                onChange={(e)=>updateConfig(methodKey as any,{posWeights:{...methodConfig.posWeights, VERB:parseFloat(e.target.value)}})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="2"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">ADJ wt</label>
                              <input type="number" step="0.1" value={methodConfig.posWeights.ADJ}
                                onChange={(e)=>updateConfig(methodKey as any,{posWeights:{...methodConfig.posWeights, ADJ:parseFloat(e.target.value)}})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="2"/>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">ADV wt</label>
                              <input type="number" step="0.1" value={methodConfig.posWeights.ADV}
                                onChange={(e)=>updateConfig(methodKey as any,{posWeights:{...methodConfig.posWeights, ADV:parseFloat(e.target.value)}})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="2"/>
                            </div>
                            <div className="space-y-2">
                              <label className="block text-sm font-medium text-gray-700 mb-1">OTHER wt</label>
                              <input type="number" step="0.1" value={methodConfig.posWeights.OTHER}
                                onChange={(e)=>updateConfig(methodKey as any,{posWeights:{...methodConfig.posWeights, OTHER:parseFloat(e.target.value)}})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm" min="0" max="2"/>
                              <label className="inline-flex items-center space-x-2">
                                <input type="checkbox" checked={methodConfig.l2Normalize}
                                  onChange={(e)=>updateConfig(methodKey as any,{l2Normalize:e.target.checked})}/>
                                <span className="text-sm">L2 Normalize</span>
                              </label>
                              <label className="inline-flex items-center space-x-2">
                                <input type="checkbox" checked={methodConfig.center}
                                  onChange={(e)=>updateConfig(methodKey as any,{center:e.target.checked})}/>
                                <span className="text-sm">Center (reduce hubness)</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Results Summary */}
      <div className="mb-6 bg-white p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-3">Expanded Active Nodes Summary</h3>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="bg-blue-50 p-3 rounded">
            <div className="text-2xl font-bold text-blue-600">{expandedNodes.phrases.length}</div>
            <div className="text-sm text-gray-600">Expanded Phrases</div>
          </div>
          <div className="bg-green-50 p-3 rounded">
            <div className="text-2xl font-bold text-green-600">{expandedNodes.words.length}</div>
            <div className="text-sm text-gray-600">Expanded Words</div>
          </div>
          <div className="bg-purple-50 p-3 rounded">
            <div className="text-2xl font-bold text-purple-600">{expandedNodes.chunks.length}</div>
            <div className="text-sm text-gray-600">Expanded Chunks</div>
          </div>
          <div className="bg-orange-50 p-3 rounded">
            <div className="text-2xl font-bold text-orange-600">{ctx.phrases.length}</div>
            <div className="text-sm text-gray-600">Direct Topic Phrases</div>
          </div>
        </div>
      </div>

      {/* Method Breakdown */}
      <div className="mb-6 bg-white p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-3">Method Results Breakdown</h3>
        <div className="space-y-2">
          {Object.entries(expandedNodes.methodBreakdown).map(([method, results]) => {
            const methodNames: Record<string, string> = {
              SEMANTIC_SIMILARITY: "Similar Meaning",
              LEXICAL_COOCCURRENCE: "Shared Words",
              POS_PATTERN_CLUSTERING: "Similar Structure",
              SESSION_HISTORY: "Past Sessions",
              POLYSEMY_NETWORKS: "Multiple Meanings",
              GLOVE_NEIGHBORHOOD: "Semantic Neighborhood",
              WORDNET_RELATIONS: "Word Relationships",
              TEMPORAL_PROXIMITY: "Recent Activity",
              CHUNK_COOCCURRENCE: "Shared Phrases"
            };
            
            return (
              <div key={method} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="font-medium">{methodNames[method]}</span>
                <span className="text-sm text-gray-600">{results.length} results</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expanded Phrases Table */}
      <div className="mb-6 bg-white p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-3">Expanded Phrases ({expandedNodes.phrases.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Phrase</th>
                <th className="text-left p-2">Method</th>
                <th className="text-left p-2">Score</th>
                <th className="text-left p-2">Confidence</th>
                <th className="text-left p-2">POS Pattern</th>
                <th className="text-left p-2">Shared Lemmas</th>
                <th className="text-left p-2">Likes</th>
              </tr>
            </thead>
            <tbody>
              {expandedNodes.phrases.map((phrase, index) => {
                const scoredNode = Object.values(expandedNodes.methodBreakdown)
                  .flat()
                  .find(s => s.node.id === phrase.id);
                
                return (
                  <tr key={phrase.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-medium">{phrase.text}</td>
                    <td className="p-2 text-blue-600">{scoredNode?.method || 'Unknown'}</td>
                    <td className="p-2">{scoredNode?.score.toFixed(2) || '0.00'}</td>
                    <td className="p-2">{scoredNode?.confidence.toFixed(2) || '0.00'}</td>
                    <td className="p-2 text-gray-600">{phrase.posPattern}</td>
                    <td className="p-2">
                      {Array.isArray((scoredNode as any)?.meta?.sharedLemmas) && (scoredNode as any).meta.sharedLemmas.length > 0
                        ? (scoredNode as any).meta.sharedLemmas.join(', ')
                        : '—'}
                    </td>
                    <td className="p-2">{phrase.stats?.likes || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Words Table */}
      <div className="mb-6 bg-white p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-3">Expanded Words ({expandedNodes.words.length})</h3>
        <div className="grid grid-cols-5 gap-4">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Nouns ({organizedWords.nouns.length})</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {organizedWords.nouns.map(word => (
                <div key={word.id} className="text-sm p-1 bg-gray-50 rounded">
                  <span className="font-medium">{word.text}</span>
                  <span className="text-gray-500 ml-1">({word.lemma})</span>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Verbs ({organizedWords.verbs.length})</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {organizedWords.verbs.map(word => (
                <div key={word.id} className="text-sm p-1 bg-gray-50 rounded">
                  <span className="font-medium">{word.text}</span>
                  <span className="text-gray-500 ml-1">({word.lemma})</span>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Adjectives ({organizedWords.adjectives.length})</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {organizedWords.adjectives.map(word => (
                <div key={word.id} className="text-sm p-1 bg-gray-50 rounded">
                  <span className="font-medium">{word.text}</span>
                  <span className="text-gray-500 ml-1">({word.lemma})</span>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Adverbs ({organizedWords.adverbs.length})</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {organizedWords.adverbs.map(word => (
                <div key={word.id} className="text-sm p-1 bg-gray-50 rounded">
                  <span className="font-medium">{word.text}</span>
                  <span className="text-gray-500 ml-1">({word.lemma})</span>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Multi-POS ({organizedWords.multiPOS.length})</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {organizedWords.multiPOS.map(word => (
                <div key={word.id} className="text-sm p-1 bg-gray-50 rounded">
                  <span className="font-medium">{word.text}</span>
                  <span className="text-gray-500 ml-1">({word.lemma})</span>
                  <div className="text-xs text-gray-400">
                    {word.posPotential?.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Chunks Table */}
      <div className="mb-6 bg-white p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-3">Expanded Chunks ({expandedNodes.chunks.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Chunk Text</th>
                <th className="text-left p-2">Score</th>
                <th className="text-left p-2">POS Pattern</th>
                <th className="text-left p-2">Word Count</th>
              </tr>
            </thead>
            <tbody>
              {expandedNodes.chunks.map(chunk => (
                <tr key={chunk.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-medium">{chunk.text}</td>
                  <td className="p-2">{chunk.score.toFixed(2)}</td>
                  <td className="p-2 text-gray-600">{chunk.posPattern}</td>
                  <td className="p-2">{chunk.lemmas.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
