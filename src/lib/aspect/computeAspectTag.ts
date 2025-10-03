// Read-only helper used by the dev tester and, later, by your ingest pipeline.
// It computes the aspect tag *from precomputed lemma tokens* (provided by winkNLP).
import type { AspectProfile, EmbeddingMap, Weights } from './inferAspect';
import { inferAspect } from './inferAspect';

export type AspectTag = {
  best: string;                               // e.g., "lemon"
  conf: number;                               // 0..1 confidence
  ranked: Array<{ id: string; score: number }>;
};

export function computeAspectTag(
  lemmaTokens: string[],                      // ← winkNLP lemma tokens
  profiles: AspectProfile[],                  // ← built from topic lemmas
  opts?: { 
    emb?: EmbeddingMap | null; 
    weights?: Weights; 
    rawTextForGuard?: string;
    winkNLP?: { nlp: any; its: any };         // ← app's winkNLP instance for consistent lemmatization
    posWeightedTokens?: Array<{lemma: string, pos: string, weight: number}>; // ← POS-weighted tokens for enhanced scoring
  }
): AspectTag {
  // If winkNLP is available, use it for consistent lemmatization of both input and aspect lemmas
  if (opts?.winkNLP) {
    const { nlp, its } = opts.winkNLP;
    
    // Lemmatize input tokens for consistency (in case they weren't properly lemmatized)
    const lemmatizedInputTokens = lemmaTokens.map(token => {
      try {
        const doc = nlp.readDoc(token);
        const lemmas = doc.tokens().out(its.lemma);
        return lemmas.length > 0 ? String(lemmas[0]).toLowerCase() : token.toLowerCase();
      } catch {
        return token.toLowerCase();
      }
    });
    
    // Create normalized aspect profiles with lemmatized lemmas
    const normalizedProfiles = profiles.map(profile => {
      try {
        const doc = nlp.readDoc(profile.lemma);
        const lemmas = doc.tokens().out(its.lemma);
        const lemmatizedLemma = lemmas.length > 0 ? String(lemmas[0]).toLowerCase() : profile.lemma.toLowerCase();
        
        return {
          ...profile,
          id: lemmatizedLemma,
          lemma: lemmatizedLemma,
        };
      } catch {
        return {
          ...profile,
          id: profile.lemma.toLowerCase(),
          lemma: profile.lemma.toLowerCase(),
        };
      }
    });
    
    // Use lemmatized input tokens as text for inferAspect
    const text = lemmatizedInputTokens.join(' ');
    
    const res = inferAspect(text, normalizedProfiles, {
      emb: opts?.emb ?? null,
      weights: opts?.weights,
      enableProperNameGuard: !!opts?.rawTextForGuard,
      posWeightedTokens: opts?.posWeightedTokens,
    });

    return {
      best: res.best.id,
      conf: res.confidence,
      ranked: res.ranked,
    };
  }
  
  // Fallback: Convert lemma tokens back to text for the existing inferAspect function
  // This maintains compatibility when winkNLP is not available
  const text = lemmaTokens.join(' ');
  
  const res = inferAspect(text, profiles, {
    emb: opts?.emb ?? null,
    weights: opts?.weights,
    enableProperNameGuard: !!opts?.rawTextForGuard,
    posWeightedTokens: opts?.posWeightedTokens,
  });

  return {
    best: res.best.id,
    conf: res.confidence,
    ranked: res.ranked,
  };
}
