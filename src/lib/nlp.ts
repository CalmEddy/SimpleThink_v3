import winkNLP from 'wink-nlp';
import type { PhraseChunk } from '../types/index.js';
import { normalizePOS, NormalizationResult, BaseTok, generatePosPattern, normalizePosTag } from './posNormalization.js';

// === Self-contained, deterministic context POS tester ===


// Initialize winkNLP with error handling
let nlp: any = null;
let isInitialized = false;
let MODEL_HAS_NER = false;

// Fallback NLP instance removed - now using centralized posNormalization

// Additional helper functions for robust NER detection
const its = () => nlp.its;

// Preserve case; only normalize smart quotes → ASCII straight quotes
const preprocessContractionsPreserveCase = (s: string): string => {
  return s
    .replace(/\u2019/g, "'") // right single quote
    .replace(/\u2018/g, "'"); // left single quote
};

// Helper functions removed - now using centralized posNormalization

// Probe NER capability
const probeNerCapability = (nlpInst: typeof nlp): boolean => {
  try {
    const doc = nlpInst.readDoc('George Washington met Thomas Edison in Paris.');
    const ents = doc.entities().out(nlpInst.its.detail) as any[];
    // Require at least one entity with a type key.
    return Array.isArray(ents) && ents.some((e) => e && typeof e.type === 'string' && e.type.length > 0);
  } catch {
    return false;
  }
};

// Initialize NLP asynchronously
const initializeNLP = async () => {
  if (isInitialized) return;
  
  try {
    // Always use real winkNLP; never swap it out.
    const { default: model } = await import('wink-eng-lite-web-model');
    nlp = winkNLP(model);
    console.log('[NLP] winkNLP model loaded');

    // Expose to window for dev tools and other components
    if (typeof window !== 'undefined') {
      (window as any).nlp = nlp;
      (window as any).its = nlp.its;
      (window as any).appLemma = (text: string) =>
        nlp.readDoc(text).tokens().out(nlp.its.lemma).map((s: string) => String(s).toLowerCase());
    }

    // Probe NER capability but DO NOT replace nlp if absent.
    MODEL_HAS_NER = probeNerCapability(nlp);
    console.info(`[NLP] NER capability: ${MODEL_HAS_NER ? 'present' : 'absent'}`);
  } catch (error) {
    console.error('[NLP] Failed to load winkNLP model:', error);
    throw error; // let caller catch; avoids silently running a broken fallback
  }
  
  isInitialized = true;
};

// Initialize nlp as null - will be set by initializeNLP()
nlp = null as any;

export interface AnalysisResult {
  tokens: string[];
  lemmas: string[];
  pos: string[];
  morphFeatures: string[]; // NEW: morphological features
}

// New function to extract raw tokens from winkNLP
export function tagTextToTokens(doc: any): BaseTok[] {
  const I = its();
  const tokens: BaseTok[] = [];
  let index = 0;
  
  // Use the original method that was working
  doc.tokens().each((t: any) => {
    const value = t.out(I.value);
    const lemma = t.out(I.lemma);
    const pos = t.out(I.pos);
    const tokenIndex = t.out(I.index);
    
    // Skip punctuation tokens
    if (pos !== 'PUNCT') {
      tokens.push({
        value: value || '',
        lemma: lemma || value || '',
        pos: pos || 'X',
        index: tokenIndex ?? index,
        sentenceId: undefined, // winkNLP lite doesn't provide sentenceId
      });
      index++;
    }
  });
  
  return tokens;
}

export class NLPAnalyzer {
  private static instance: NLPAnalyzer;
  
  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): NLPAnalyzer {
    if (!NLPAnalyzer.instance) {
      NLPAnalyzer.instance = new NLPAnalyzer();
    }
    return NLPAnalyzer.instance;
  }

  async analyzeText(text: string): Promise<AnalysisResult> {
    await initializeNLP();

    // IMPORTANT: do not lowercase before readDoc
    const preprocessed = preprocessContractionsPreserveCase(text);
    const doc = nlp.readDoc(preprocessed);

    // Extract raw tokens from winkNLP
    const baseTokens = tagTextToTokens(doc);
    
    // Use centralized POS normalization
    const normalizationResult = normalizePOS(baseTokens);
    
    // Extract the normalized data for backward compatibility
    const tokens: string[] = [];
    const lemmas: string[] = [];
    const pos: string[] = [];
    const morphFeatures: string[] = [];

    for (const token of normalizationResult.tokens) {
      tokens.push(token.value);
      lemmas.push(token.lemma);
      pos.push(token.pos);
      
      // Extract morphological features
      let morph = '';
      try {
        const I = its();
        const t = doc.tokens().out(I.detail)[token.index];
        if (t) {
          const morphInfo = t.out ? t.out(I.morph) : null;
          if (morphInfo) {
            morph = morphInfo;
          }
        }
      } catch {
        // Fallback: infer from token form
        morph = inferMorphFromToken(token.value, token.lemma, token.pos);
      }
      morphFeatures.push(morph);
    }

    return { tokens, lemmas, pos, morphFeatures };
  }

  inferPosPattern(pos: string[]): string {
    // Use centralized POS pattern generation
    return generatePosPattern(pos);
  }

  extractChunks(lemmas: string[], pos: string[]): PhraseChunk[] {
    const normalizedPos = pos.map(p => normalizePosTag(p));
    
    // Extract only meaningful patterns
    const chunks = this.extractMeaningfulChunks(lemmas, normalizedPos);
    
    // Filter by length (3-8 tokens, except NOUN-NOUN which can be 2 tokens)
    const filteredChunks = chunks.filter(chunk => {
      const tokenCount = chunk.span[1] - chunk.span[0] + 1;
      const pattern = chunk.posPattern;
      
      // Allow NOUN-NOUN patterns with 2 tokens, but exclude pronouns
      if (pattern === 'NOUN-NOUN' && tokenCount === 2) {
        // Check if either word is a pronoun - if so, reject this chunk
        const startIndex = chunk.span[0];
        const endIndex = chunk.span[1];
        const actualPos = pos.slice(startIndex, endIndex + 1);
        
        // Reject if any word is a pronoun
        if (actualPos.includes('PRON')) {
          return false;
        }
        
        return true;
      }
      
      return tokenCount >= 3 && tokenCount <= 8;
    });
    
    // Deduplicate and score chunks
    return this.deduplicateAndScoreChunks(filteredChunks);
  }

  // Helper functions removed - now using centralized posNormalization


  // Extraction functions removed - now using centralized posNormalization

  private extractMeaningfulChunks(lemmas: string[], pos: string[]): PhraseChunk[] {
    const chunks: PhraseChunk[] = [];
    
    // Extract only the 8 most valuable chunk patterns directly
    const desiredPatterns = [
      'NOUN-NOUN',           // Compound nouns: "coffee cup", "cherry pie"
      'PROPN-PROPN',         // Proper noun compounds: "Andrew Jackson", "New York"
      'DET-ADJ-NOUN',        // Basic noun phrases: "the big house"
      'DET-ADJ-PROPN',       // Proper noun phrases: "the beautiful Paris"
      'VERB-ADP-NOUN',       // Verb phrases: "goes to school"
      'VERB-ADP-PROPN',      // Verb phrases with proper nouns: "goes to Paris"
      'NOUN-ADP-NOUN',       // Prepositional phrases: "book on table"
      'PROPN-ADP-PROPN'      // Prepositional phrases with proper nouns: "Paris in France"
    ];
    
    // Use sliding window to find these specific patterns
    for (let i = 0; i <= lemmas.length - 2; i++) {
      for (let size = 2; size <= Math.min(4, lemmas.length - i); size++) {
        const chunkPos = pos.slice(i, i + size);
        const pattern = chunkPos.join('-');
        
        // Only extract if it matches our desired patterns
        if (desiredPatterns.includes(pattern)) {
          const chunk = this.createChunk(lemmas, pos, i, i + size - 1, 'MEANINGFUL');
          if (chunk) chunks.push(chunk);
        }
      }
    }
    
    return chunks;
  }

  private createChunk(
    lemmas: string[], 
    pos: string[], 
    start: number, 
    end: number, 
    type: string
  ): PhraseChunk | null {
    if (start < 0 || end >= lemmas.length || start > end) return null;
    
    const chunkLemmas = lemmas.slice(start, end + 1);
    const chunkPos = pos.slice(start, end + 1);
    const posPattern = generatePosPattern(chunkPos);
    
    // Generate unique ID by including timestamp and random component to avoid duplicates
    const uniqueId = `${type}:${start}:${end}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      id: uniqueId,
      text: chunkLemmas.join(' '),
      lemmas: chunkLemmas,
      posPattern,
      span: [start, end],
      score: this.calculateChunkScore(chunkLemmas, chunkPos, end - start + 1),
    };
  }

  private calculateChunkScore(_lemmas: string[], _pos: string[], _length: number): number {
    // Since we're only extracting patterns we want, return a default score
    // This maintains compatibility with existing code that expects scores
    return 1.0;
  }

  private deduplicateAndScoreChunks(chunks: PhraseChunk[]): PhraseChunk[] {
    // Since we're only extracting patterns we want, just return chunks directly
    // No need for scoring/sorting since we already extracted only valuable patterns
    return chunks.slice(0, 8); // Ensure we don't exceed 8 chunks
  }
}

// Types for the robust POS testing system
type UPOS =
  | 'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PROPN' | 'ADP' | 'AUX' | 'DET'
  | 'PRON' | 'PART' | 'CCONJ' | 'SCONJ' | 'NUM' | 'INTJ' | 'SYM' | 'X' | 'PUNCT';

interface AnalyzeResult {
  tokens: string[];          // surface forms
  pos: string[];             // UPOS per token
  lemmas?: string[];         // optional lemma array (recommended)
}

// --- Robust frames (balanced coverage) ---
const POLYSEMY_FRAMES: Array<{ id: string; want: UPOS; s: (w: string) => string }> = [
  // NOUN
  { id: 'N1', want: 'NOUN', s: w => `The ${w} is ready.` },
  { id: 'N2', want: 'NOUN', s: w => `That ${w} was helpful.` },
  { id: 'N3', want: 'NOUN', s: w => `The ${w} of the project was discussed.` },

  // VERB (finite + infinitive + imperative)
  { id: 'V1', want: 'VERB', s: w => `We will ${w} tomorrow.` },
  { id: 'V2', want: 'VERB', s: w => `To ${w} takes courage.` },
  { id: 'V3', want: 'VERB', s: w => `Please ${w} carefully.` },

  // ADJ (predicative & attributive with linkers)
  { id: 'A1', want: 'ADJ', s: w => `It is very ${w}.` },
  { id: 'A2', want: 'ADJ', s: w => `The ${w} idea worked.` },
  { id: 'A3', want: 'ADJ', s: w => `The result seems ${w}.` },
  { id: 'A4', want: 'ADJ', s: w => `The choice became ${w}.` },

  // ADV (post-verbal manner)
  { id: 'R1', want: 'ADV', s: w => `They moved ${w}.` },
  { id: 'R2', want: 'ADV', s: w => `She spoke ${w}.` },
  { id: 'R3', want: 'ADV', s: w => `He finished ${w}.` },
];

// --- Anti-frames (down-vote spurious tags) ---
const POLYSEMY_ANTI_FRAMES: Array<{ id: string; blocks: UPOS; s: (w: string) => string }> = [
  { id: 'ANTI_V', blocks: 'VERB', s: w => `The very ${w} was approved.` }, // NP slot → verb should not fit
  { id: 'ANTI_A', blocks: 'ADJ',  s: w => `We will ${w} now.` },           // verb slot → adjective should not fit
  { id: 'ANTI_R', blocks: 'ADV',  s: w => `The ${w} solution is ready.` }, // attributive slot → adverb should not fit
  { id: 'ANTI_N', blocks: 'NOUN', s: w => `They will ${w} quickly.` },     // verb slot → noun should not fit
];

// --- Vote thresholds (tune if needed) ---
const MIN_VOTES: Partial<Record<UPOS, number>> = {
  NOUN: 1,
  VERB: 1,
  ADJ:  1,
  ADV:  1,
};

function normalizeUPOS(tag: string | undefined): UPOS | null {
  if (!tag) return null;
  const t = tag.toUpperCase() as UPOS;
  if (t === 'PUNCT' || t === 'X') return null;
  return t;
}

function findTargetIndex(a: AnalyzeResult, word: string): number {
  const w = word.toLowerCase();
  // Prefer lemma match
  if (Array.isArray(a.lemmas)) {
    const i = a.lemmas.findIndex(l => (l || '').toLowerCase() === w);
    if (i !== -1) return i;
  }
  // Fallback: surface token match
  return a.tokens.findIndex(t => (t || '').toLowerCase() === w);
}

/**
 * Test a word in different grammatical contexts to discover all possible POS tags
 * Uses robust frames with anti-frames, lemma-first matching, and vote thresholds
 */
export async function testWordInContexts(word: string): Promise<{
  contexts: Array<{sentence: string, pos: string}>;
  uniquePOS: string[];
  isPolysemous: boolean;
}> {
  const results: Array<{ sentence: string; pos: string }> = [];
  const votes = new Map<UPOS, number>();

  // Helper to add a vote
  const bump = (p: UPOS) => votes.set(p, (votes.get(p) || 0) + 1);
  const drop = (p: UPOS) => votes.set(p, Math.max(0, (votes.get(p) || 0) - 1));

  // 1) Run positive frames (up-votes)
  for (const f of POLYSEMY_FRAMES) {
    const sentence = f.s(word);
    try {
      const analysis = (await analyzeText(sentence)) as AnalyzeResult;
      const idx = findTargetIndex(analysis, word);
      if (idx === -1) continue;

      const upos = normalizeUPOS(analysis.pos[idx]);
      if (!upos) continue;

      results.push({ sentence, pos: upos });
      bump(upos);
    } catch (err) {
      console.warn(`Context test failed: ${f.id}`, err);
    }
  }

  // 2) Run anti-frames (down-votes)
  for (const af of POLYSEMY_ANTI_FRAMES) {
    const sentence = af.s(word);
    try {
      const analysis = (await analyzeText(sentence)) as AnalyzeResult;
      const idx = findTargetIndex(analysis, word);
      if (idx === -1) continue;

      const upos = normalizeUPOS(analysis.pos[idx]);
      if (!upos) continue;

      results.push({ sentence, pos: upos });
      if (upos === af.blocks) drop(upos);
    } catch (err) {
      console.warn(`Anti-frame failed: ${af.id}`, err);
    }
  }

  // 3) Threshold & finalize
  const uniquePOS = Array.from(votes.entries())
    .filter(([tag, n]) => n >= (MIN_VOTES[tag] ?? 1))
    .map(([tag]) => tag);

  return {
    contexts: results,
    uniquePOS,
    isPolysemous: uniquePOS.length > 1,
  };
}


// Export singleton instance and convenience functions
export const nlpAnalyzer = NLPAnalyzer.getInstance();

export const analyzeText = async (text: string): Promise<AnalysisResult> => nlpAnalyzer.analyzeText(text);
export const inferPosPattern = (pos: string[]): string => nlpAnalyzer.inferPosPattern(pos);
export const extractChunks = (lemmas: string[], pos: string[]): PhraseChunk[] => 
  nlpAnalyzer.extractChunks(lemmas, pos);

// New function that returns the full normalization result
export const analyze = async (text: string): Promise<NormalizationResult> => {
  await initializeNLP();
  const preprocessed = preprocessContractionsPreserveCase(text);
  const doc = nlp.readDoc(preprocessed);
  const baseTokens = tagTextToTokens(doc);
  return normalizePOS(baseTokens);
};

// NEW: Helper function to infer morphological features from token form
function inferMorphFromToken(token: string, lemma: string, pos: string): string {
  if (pos === 'VERB') {
    if (token.endsWith('ing')) return 'participle';
    if (token.endsWith('ed')) return 'past';
    if (token.endsWith('s') && token !== lemma) return 'present_3rd';
    return 'base';
  }
  if (pos === 'ADJ') {
    if (token.endsWith('er')) return 'comparative';
    if (token.endsWith('est')) return 'superlative';
    return 'base';
  }
  return 'base';
}

// Helper function for composer to analyze text with full POS pipeline
export async function analyzeTextForComposer(text: string): Promise<{
  start: number;
  end: number;
  text: string;
  lemma: string;
  pos: string;
  posSet: string[];
}[]> {
  try {
    // Ensure NLP is initialized
    await initializeNLP();
    if (!nlp) {
      throw new Error('NLP not initialized');
    }

    // Create document and extract tokens
    const doc = nlp.readDoc(text);
    const baseTokens = tagTextToTokens(doc);
    
    // Normalize POS tags
    const normalizedResult = normalizePOS(baseTokens);
    
    // Convert to composer format
    return normalizedResult.tokens.map((token) => ({
      start: token.index,
      end: token.index + token.value.length,
      text: token.value,
      lemma: token.lemma,
      pos: token.pos,
      posSet: guessPOSSetForWord(token.value, token.pos)
    }));
  } catch (error) {
    console.warn('[NLP] Failed to analyze text for composer:', error);
    throw error;
  }
}

// Helper to guess POS set for a word (similar to composer's guessPOSSet but with more context)
function guessPOSSetForWord(word: string, currentPos: string): string[] {
  const lower = word.toLowerCase();
  const set = new Set<string>();
  
  // Always include the current POS
  set.add(currentPos);
  
  // Add common alternatives based on word patterns
  if (/ly$/.test(lower)) set.add('ADV');
  if (/ing$|ed$/.test(lower)) set.add('VERB');
  if (/ous$|ful$|able$|ible$|al$|ic$|ive$|less$|y$/.test(lower)) set.add('ADJ');
  if (['the','a','an','this','that','these','those'].includes(lower)) set.add('DET');
  if (['and','or','but','nor','yet','so'].includes(lower)) set.add('CCONJ');
  if (['in','on','at','with','by','to','from','for','of','over','under'].includes(lower)) set.add('ADP');
  if (/^[A-Z]/.test(word)) set.add('PROPN');
  
  // Default to NOUN if no other patterns match
  if (set.size === 1 && set.has(currentPos)) {
    set.add('NOUN');
  }
  
  return Array.from(set);
}