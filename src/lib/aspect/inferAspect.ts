// Lightweight aspect inference (read-only utilities)
// - Build aspect profiles from a topic's lemmas
// - Optional GloVe embeddings (JSON map {word:[...]} or GloVe .txt lines)
// - Score a user phrase against aspects using adjustable weights
// No writes, no external network.

export type EmbeddingMap = Map<string, Float32Array>;

export type AspectProfile = {
  id: string;          // normalized lemma, e.g., "life"
  lemma: string;       // normalized lemma (used for matching/embeddings)
  raw?: string;        // original raw token if provided (for UI)
  halo: string[];      // related words (from GloVe nearest neighbors)
  centroid?: Float32Array; // average of lemma + halo vectors (if embeddings loaded)
};

export type AspectScores = {
  best: { id: string; score: number };
  ranked: Array<{ id: string; score: number }>;
  confidence: number; // 0..1 (margin-based)
};

export type Weights = {
  exactWord: number;     // presence of lemma in text
  relatedWords: number;  // presence of any halo word in text
  similarity: number;    // cosine(text, centroid)
  properNamePenalty: number; // penalty if exact match appears capitalized oddly (very light guard)
};

export const DEFAULT_WEIGHTS: Weights = {
  exactWord: 3.0,
  relatedWords: 1.5,
  similarity: 0.75,
  properNamePenalty: 0.5,
};

// --- Normalization helpers ---
// Import global stop words for consistency across the application
import { isStopWord } from '../stopWords.js';

export function normalizeLemma(s: string): string {
  if (!s || typeof s !== 'string') return "";
  
  // Handle contractions and special cases first
  let cleaned = s.toLowerCase()
    .replace(/n't/g, '') // Remove contractions like "don't" -> "don"
    .replace(/'s/g, '') // Remove possessive 's
    .replace(/'re/g, '') // Remove "are" contractions
    .replace(/'ve/g, '') // Remove "have" contractions
    .replace(/'ll/g, '') // Remove "will" contractions
    .replace(/'d/g, '') // Remove "would/had" contractions
    .replace(/'m/g, '') // Remove "am" contractions
    .replace(/[^a-z0-9]+/g, ""); // Remove all other punctuation
  
  // Filter out very short words, empty strings, and meaningless tokens
  if (cleaned.length < 2 || cleaned === 'nt' || cleaned === 's' || cleaned === 're' || cleaned === 've' || cleaned === 'll' || cleaned === 'd' || cleaned === 'm') {
    return "";
  }
  
  // naive singularize common trailing 's' (avoid very short words)
  if (cleaned.length > 4 && cleaned.endsWith("s")) return cleaned.slice(0, -1);
  return cleaned;
}

export function tokenizeToLemmas(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  // Handle contractions before tokenization
  const preprocessed = text.toLowerCase()
    .replace(/n't/g, ' not') // "don't" -> "do not"
    .replace(/'s/g, ' is') // "he's" -> "he is" 
    .replace(/'re/g, ' are') // "they're" -> "they are"
    .replace(/'ve/g, ' have') // "I've" -> "I have"
    .replace(/'ll/g, ' will') // "I'll" -> "I will"
    .replace(/'d/g, ' would') // "I'd" -> "I would"
    .replace(/'m/g, ' am'); // "I'm" -> "I am"
  
  // Tokenize and filter
  return preprocessed
    .split(/[^a-z0-9]+/g)
    .filter(token => token.length >= 2); // Filter out single characters
}

export function tokenizeToContentWords(text: string): string[] {
  // Tokenize and filter out stop words using global wordbank for consistency
  const tokens = tokenizeToLemmas(text);
  return tokens.filter(token => !isStopWord(token));
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function meanVec(vecs: Float32Array[]): Float32Array | undefined {
  if (!vecs.length) return undefined;
  const dim = vecs[0].length;
  const out = new Float32Array(dim);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vecs.length;
  return out;
}

export function textVector(terms: string[], emb: EmbeddingMap | null): Float32Array | undefined {
  if (!emb) return;
  const vecs: Float32Array[] = [];
  for (const t of terms) {
    const v = emb.get(t);
    if (v) vecs.push(v);
  }
  return meanVec(vecs);
}

// Grammatical weight function for POS-based importance scoring
export function getGrammaticalWeight(pos: string): number {
  const weights: { [key: string]: number } = {
    // Highest importance - typically the main topic/focus
    'NOUN': 1.0,
    'PROPN': 1.0,
    
    // Medium importance - supporting concepts
    'ADJ': 0.7,
    
    // Medium-low importance - modifiers
    'ADV': 0.5,
    
    // Lower importance - functional words
    'VERB': 0.3,           // Actions (usually not the main topic)
    'PRON': 0.2,           // Pronouns
    
    // Lowest importance - functional words
    'DET': 0.1,            // Articles
    'ADP': 0.1,            // Prepositions
    'CCONJ': 0.1,          // Conjunctions
  };
  
  return weights[pos] ?? 0.5; // Default fallback weight
}

// Budgeted neighbor search so 400k GloVe is usable in-browser
export function buildAspectProfiles(
  rawLemmas: string[],
  emb: EmbeddingMap | null,
  haloK: number,
  neighborBudget = 20000  // cap comparisons per aspect (sampled)
): AspectProfile[] {
  // 1) normalize + filter using global stop words
  const norm = rawLemmas
    .map(s => ({ raw: s, lemma: normalizeLemma(s) }))
    .filter(x => x.lemma && !isStopWord(x.lemma));
  // de-dup by normalized lemma
  const byLemma = new Map<string, { raw: string; lemma: string }>();
  for (const x of norm) if (!byLemma.has(x.lemma)) byLemma.set(x.lemma, x);
  const uniq = Array.from(byLemma.values());

  const profiles: AspectProfile[] = uniq.map(x => ({
    id: x.lemma,
    lemma: x.lemma,
    raw: x.raw,
    halo: [],
  }));

  if (!emb || haloK <= 0) return profiles; // no embeddings or no halo requested

  const vocab = Array.from(emb.keys());
  const V = vocab.length;
  const sampleCount = Math.min(neighborBudget, V);

  function sampleVocab(n: number): string[] {
    if (n >= V) return vocab;
    const used = new Set<number>();
    const out: string[] = [];
    while (out.length < n) {
      const i = (Math.random() * V) | 0;
      if (used.has(i)) continue;
      used.add(i);
      out.push(vocab[i]);
    }
    return out;
  }

  const candidates = sampleVocab(sampleCount).filter(w => !isStopWord(w));

  for (const p of profiles) {
    const baseVec = emb.get(p.lemma);
    if (!baseVec) {
      // Missing vector for lemma—leave halo empty, centroid undefined
      continue;
    }
    type Item = { w: string; s: number };
    const heap: Item[] = []; // small top-K min-heap simulated via sort

    for (const w of candidates) {
      if (w === p.lemma) continue;
      const v = emb.get(w)!;
      if (!v) continue;
      const s = cosine(baseVec, v);
      if (heap.length < haloK) {
        heap.push({ w, s });
        heap.sort((a, b) => a.s - b.s);
      } else if (s > heap[0].s) {
        heap[0] = { w, s };
        heap.sort((a, b) => a.s - b.s);
      }
    }
    heap.sort((a, b) => b.s - a.s);
    p.halo = heap.map(x => x.w);
    const haloVecs = p.halo.map(h => emb.get(h)!).filter(Boolean);
    const centroid = meanVec([baseVec, ...haloVecs].filter(Boolean) as Float32Array[]);
    if (centroid) p.centroid = centroid;
  }
  return profiles;
}

export function inferAspect(
  text: string,
  aspects: AspectProfile[],
  opt: {
    weights?: Weights;
    enableProperNameGuard?: boolean;
    emb?: EmbeddingMap | null;
    posWeightedTokens?: Array<{lemma: string, pos: string, weight: number}>;
  } = {}
): AspectScores {
  const W = { ...DEFAULT_WEIGHTS, ...(opt.weights || {}) };
  
  // Use POS-weighted tokens if available, otherwise fall back to traditional approach
  let terms: string[];
  let tokenWeights: Map<string, number> = new Map();
  
  if (opt.posWeightedTokens) {
    // Use POS-weighted tokens for enhanced scoring, but still filter out stop words
    const filteredTokens = opt.posWeightedTokens.filter(t => !isStopWord(t.lemma));
    terms = filteredTokens.map(t => t.lemma);
    filteredTokens.forEach(t => {
      tokenWeights.set(t.lemma, t.weight);
    });
  } else {
    // Fall back to traditional approach
    terms = tokenizeToContentWords(text);
    // All tokens get equal weight (1.0)
    terms.forEach(term => tokenWeights.set(term, 1.0));
  }
  
  const seen = new Set(terms);
  const tVec = opt.emb ? textVector(terms, opt.emb) : undefined;

  const ranked: Array<{ id: string; score: number }> = [];
  for (const a of aspects) {
    let s = 0;
    // direct lemma presence with POS weighting
    if (seen.has(a.lemma)) {
      const tokenWeight = tokenWeights.get(a.lemma) ?? 1.0;
      s += W.exactWord * tokenWeight;
    }
    // related-word (halo) presence with POS weighting
    if (a.halo?.some(h => seen.has(h))) {
      // Find the highest weight among matching halo words
      const matchingHaloWeights = a.halo
        .filter(h => seen.has(h))
        .map(h => tokenWeights.get(h) ?? 1.0);
      const maxHaloWeight = matchingHaloWeights.length > 0 ? Math.max(...matchingHaloWeights) : 1.0;
      s += W.relatedWords * maxHaloWeight;
    }
    // cosine tie-breaker
    if (tVec && a.centroid) s += W.similarity * cosine(tVec, a.centroid);
    // light guard for proper name confusion (optional)
    if (opt.enableProperNameGuard) {
      // If the only match in the original text is a TitleCase token (rough proxy)
      const titleCaseHit = new RegExp(`\\b${a.lemma[0].toUpperCase()}${a.lemma.slice(1)}\\b`).test(text);
      if (titleCaseHit && !seen.has(a.lemma)) s -= W.properNamePenalty;
    }
    ranked.push({ id: a.id, score: s });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0] ?? { id: 'ambiguous', score: 0 };
  const second = ranked[1]?.score ?? 0;
  // margin-based confidence (0..1)
  const margin = Math.max(0, best.score - second);
  const confidence = Math.max(0, Math.min(1, margin / (W.exactWord + W.relatedWords + W.similarity)));
  return { best, ranked, confidence };
}

// ----- GloVe loaders -----

export async function loadEmbeddingsFromFile(file: File): Promise<{ map: EmbeddingMap; dim: number }> {
  const text = await file.text();
  return loadEmbeddingsFromString(text);
}

export function loadEmbeddingsFromString(text: string): { map: EmbeddingMap; dim: number } {
  const map: EmbeddingMap = new Map();
  // JSON? Expect {"word":[...],...}
  const first = text.trim().slice(0, 1);
  if (first === '{' || first === '[') {
    const obj = JSON.parse(text);
    const entries = Array.isArray(obj) ? obj : Object.entries(obj);
    let dim = 0;
    for (const [w, arr] of entries as any[]) {
      const v = Float32Array.from(arr as number[]);
      dim = dim || v.length;
      map.set((w as string).toLowerCase(), v);
    }
    return { map, dim };
  }
  // Otherwise assume GloVe .txt: "word val val val..."
  let dim = 0;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const w = parts[0].toLowerCase();
    const vec = Float32Array.from(parts.slice(1).map(Number));
    dim = dim || vec.length;
    map.set(w, vec);
  }
  return { map, dim };
}
