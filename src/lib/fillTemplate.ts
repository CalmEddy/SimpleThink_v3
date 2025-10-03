import { TemplateToken, UnifiedTemplate, SelectionSource, POS, MorphFeature } from '../types/index.js';

// Reuse your existing morphology util
import { tenseConverter, type MorphologicalType } from './tenseConverter.js';
import { RandomizationConfigManager } from './randomization/index.js';

type ContextWord = {
  id: string;
  text: string;
  lemma?: string;
  pos?: POS[] | string[];
};

type Context = {
  words: ContextWord[];
  // keep whatever else you already have; not used here
};

export interface FillInput {
  tpl: UnifiedTemplate;
  ctx: Context;
  lockedSet: Set<string>;
  wordBank: Record<string, string[]>;
}

export interface FillResult {
  surface: string;
  chosen: string[];
}

const POLICY_STANDARD: SelectionSource[] = ['LOCKED', 'CONTEXT', 'BANK'];
const POLICY_PHRASE: SelectionSource[]   = ['LOCKED', 'CONTEXT', 'LITERAL', 'BANK'];

export async function realizeTemplate(input: FillInput): Promise<FillResult> {
  const { tpl } = input;
  const binds = new Map<string, { surface: string; lemma?: string; pos: POS }>();
  const out: string[] = [];

  // Cache randomization service to avoid repeated creation
  const configManager = RandomizationConfigManager.getInstance();
  const randomizationService = await configManager.createService();

  // Pre-filter context by POS to optimize lookups
  const contextByPOS = new Map<POS, ContextWord[]>();
  for (const word of input.ctx.words) {
    const posArray = toArray(word.pos);
    for (const pos of posArray) {
      const basePos = basePOS(pos) as POS;
      if (!contextByPOS.has(basePos)) {
        contextByPOS.set(basePos, []);
      }
      contextByPOS.get(basePos)!.push(word);
    }
  }

  function posCompatible(requested: POS | undefined, got: POS | undefined): boolean {
    if (!requested || !got) return true;
    if (requested === "PROPN") return got === "PROPN";        // PROPN only swaps with PROPN
    if (requested === "NOUN")  return got !== "PROPN";        // NOUN must not receive PROPN
    return requested === got;                                 // others must match exactly
  }

  async function repickStrict(input: FillInput, token: any): Promise<{ surface:string; lemma?:string; pos:POS }> {
    // Try re-picking up to a few times via the existing policy
    for (let i = 0; i < 5; i++) {
      const attempt = await pickByPolicy(input, token.pos, token.selectionPolicy ?? POLICY_STANDARD, token.fallbackLiteral, randomizationService, contextByPOS);
      if (posCompatible(token.pos, attempt.pos)) return attempt;
    }
    // As a last resort, filter context by POS and pick a random compatible word
    const pool = (input.ctx?.words ?? []).filter((w:any) => posCompatible(token.pos, w.pos));
    if (pool.length) {
      const w = randomizationService.pickFromArray(pool);
      if (w) {
        return { surface: w.surface ?? w.text ?? w.lemma ?? "", lemma: w.lemma, pos: w.pos };
      }
    }
    // If absolutely nothing compatible exists, fall back to original attempt (let caller render literal)
    return { surface: token.fallbackLiteral ?? "", lemma: undefined, pos: token.pos };
  }

  for (const token of tpl.tokens) {
    if (token.kind === 'literal') {
      out.push(token.surface);
      continue;
    }

    if (token.kind === 'subtemplate') {
      // Inline recursive realization
      const subTpl: UnifiedTemplate = {
        id: `${tpl.id}::sub`,
        text: '', tokens: token.tokens, createdInSessionId: tpl.createdInSessionId,
      };
      const sub = await realizeTemplate({ ...input, tpl: subTpl });
      out.push(sub.surface);
      continue;
    }

    // Slot
    const policy = token.selectionPolicy ?? POLICY_STANDARD;

    // Binding reuse
    if (token.bindId && binds.has(token.bindId)) {
      const prev = binds.get(token.bindId)!;
      const rendered = await morphRender(prev.surface, prev.lemma, prev.pos, token.morph);
      out.push(rendered);
      continue;
    }

    // Choose by policy
    let choice = await pickByPolicy(input, token.pos, policy, token.fallbackLiteral, randomizationService, contextByPOS);
    if (!posCompatible(token.pos, choice.pos)) {
      choice = await repickStrict(input, token);
    }
    const rendered = await morphRender(choice.surface, choice.lemma, token.pos, token.morph);

    if (token.bindId) {
      binds.set(token.bindId, { surface: rendered, lemma: choice.lemma, pos: token.pos });
    }
    out.push(rendered);
  }

  return { surface: tidySpacing(out.join(' ')), chosen: out };
}

async function pickByPolicy(
  input: FillInput,
  pos: POS,
  policy: SelectionSource[],
  fallbackLiteral: string | undefined,
  randomizationService: any,
  contextByPOS: Map<POS, ContextWord[]>
): Promise<{ surface: string; lemma?: string; pos: POS }> {
  for (const src of policy) {
    const picked = await selectFromSource(src, input, pos, fallbackLiteral, randomizationService, contextByPOS);
    if (picked) {
      return picked;
    }
  }
  
  return { surface: '', pos: pos };
}

async function selectFromSource(
  src: SelectionSource,
  input: FillInput,
  pos: POS,
  fallbackLiteral: string | undefined,
  randomizationService: any,
  contextByPOS: Map<POS, ContextWord[]>
): Promise<{ surface: string; lemma?: string; pos: POS } | null> {
  const { ctx, lockedSet, wordBank } = input;

  if (src === 'LOCKED') {
    const pool = ctx.words.filter(w => includesPOS(w.pos, pos) && lockedSet.has(w.id));
    const w = await pickWord(pool, randomizationService);
    if (w) {
      return { surface: w.text, lemma: w.lemma, pos: pos };
    }
    return null;
  }

  if (src === 'CONTEXT') {
    // Use optimized POS filtering instead of filtering all words
    const basePos = basePOS(pos) as POS;
    const posWords = contextByPOS.get(basePos) || [];
    const exactWords = contextByPOS.get(pos as POS) || [];
    const pool = [...exactWords, ...posWords].filter(w => includesPOS(w.pos, pos));
    
    const w = await pickWord(pool, randomizationService);
    if (w) {
      return { surface: w.text, lemma: w.lemma, pos: pos };
    }
    return null;
  }

  if (src === 'LITERAL') {
    if (fallbackLiteral) {
      return { surface: fallbackLiteral, pos: pos };
    }
    return null;
  }

  // BANK (try exact key, then base POS)
  const exact = (wordBank as any)[pos] as string[] | undefined;
  const base = (wordBank as any)[basePOS(pos)] as string[] | undefined;
  
  const fb = exact && exact.length ? exact : base;
  if (fb && fb.length) {
    const selected = await pickString(fb, randomizationService);
    return { surface: selected, pos: pos };
  }
  return null;
}

function basePOS(tag: string): string {
  // Normalize case, strip any morphology suffix after the first colon
  return String(tag).toUpperCase().split(':', 1)[0];
}

function toArray<T>(v: T[] | T | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Returns true if the word's POS list is compatible with the slot POS.
 * Compatible means base categories match (e.g., VERB == VERB:past and vice versa).
 */
function includesPOS(posList: POS[] | string[] | undefined, wanted: POS): boolean {
  const arr = toArray(posList);
  
  if (!arr.length) {
    return false;
  }

  const wantedBase = basePOS(wanted);
  
  for (const p of arr) {
    const pStr = String(p).toUpperCase();
    const pBase = basePOS(pStr);
    
    if (pStr === wanted.toUpperCase()) {
      return true;             // exact match
    }
    if (pBase === wantedBase) {
      return true;              // base-category match
    }
  }
  
  return false;
}

async function morphRender(surface: string, lemma: string | undefined, pos: POS, morph?: MorphFeature): Promise<string> {
  if (!morph) return surface;
  // Reuse your existing morphology function; signature may be different in your project.
  // If your applyMorphIfNeeded expects (surface, lemma, pos, morph) keep it:
  return applyMorphIfNeeded(surface, lemma, pos, morph);
}

// Reuse the existing morphology function from promptEngine
async function applyMorphIfNeeded(
  surface: string,
  lemma: string | undefined,
  basePos: string,
  morph: MorphFeature | null
): Promise<string> {
  if (!morph || morph === 'base') return surface;
  // Prefer lemma when available; fall back to surface for regular forms.
  const seed = lemma && lemma.length ? lemma : surface;
  try {
    const converted = await tenseConverter.convertWord(seed, basePos, morph as MorphologicalType);
    // Keep capitalization if the original token was capitalized (sentence start, etc.)
    if (!converted || converted === seed) return surface;

    const isCapitalized = /^[A-Z]/.test(surface);
    return isCapitalized ? converted.charAt(0).toUpperCase() + converted.slice(1) : converted;
  } catch {
    return surface;
  }
}

async function pickWord<T>(arr: T[], randomizationService: any): Promise<T | null> {
  if (!arr.length) return null;
  return randomizationService.pickFromArray(arr);
}

async function pickString(arr: string[], randomizationService: any): Promise<string> {
  return randomizationService.pickFromArray(arr) || '';
}

function tidySpacing(s: string): string {
  return s.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
