import { nanoid } from "nanoid";
import type { AIResponseJSON } from "./AIService";
import type { TemplateDoc, EphemeralPrompt } from "../../types/index";
// import { parseTemplateTextToTokens } from "../parseTemplateText"; // Not used in this implementation
import { convertTemplateDocToUnified } from "../composer";
import { realizeTemplate } from "../fillTemplate";
import { AIEphemeralStore } from "./AIEphemeralStore";
import { normalizeStyleTag } from './AIService';

// Prefer TEXT unless we are very sure it's valid JSON in our expected shape.
export function detectResponseFormat(raw: unknown): 'json' | 'text' {
  // If it's a string that contains our text markers, treat as text.
  if (typeof raw === 'string') {
    // Heuristic: our text format contains [[seed]] [[STYLE]]
    if (/\[\[[^\]]+\]\]\s*\[\[[^\]]+\]\]/.test(raw)) return 'text';
    // If it doesn't look like JSON object text, default to text.
    const trimmed = raw.trim();
    if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return 'text';
    // Try parse; if it fails, treat as text.
    try {
      const parsed = JSON.parse(trimmed);
      // Validate minimal expected shape before declaring JSON.
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as any).words) &&
        ((parsed as any).premise === undefined || Array.isArray((parsed as any).premise)) &&
        ((parsed as any).seed_words === undefined || Array.isArray((parsed as any).seed_words))
      ) {
        return 'json';
      }
      return 'text';
    } catch {
      return 'text';
    }
  }
  // If it's already an object, assume JSON (callers may have parsed it upstream).
  if (raw && typeof raw === 'object') return 'json';
  // Fallback
  return 'text';
}

export function parseWhimsyLine(line: string): { text: string; seed: string; style: string } | null {
  if (!line) return null;
  
  // Try new format first: phrase [[SW:seed]] [[CN:comedian]]
  const newFormatMatch = line.match(/^(.*?)\s\[\[SW:([^\]]+)\]\]\s\[\[CN:([^\]]+)\]\]\s*$/);
  if (newFormatMatch) {
    const text = newFormatMatch[1].trim();
    const seed = newFormatMatch[2].trim();
    const comedian = newFormatMatch[3].trim();
    
    // Convert comedian to style using the mapping
    const style = convertComedianToStyle(comedian);
    return { text, seed, style };
  }
  
  // Fallback to old format: phrase [[seed]] [[style]]
  const oldFormatMatch = line.match(/^(.*)\s\[\[([^\]]+)\]\]\s\[\[([^\]]+)\]\]\s*$/);
  if (oldFormatMatch) {
    const text = oldFormatMatch[1].trim();
    const seed = oldFormatMatch[2].trim();
    const styleRaw = oldFormatMatch[3].trim();
    const style = normalizeStyleTag(styleRaw);
    if (!style) return null; // drop unknown/antiquated styles
    return { text, seed, style };
  }
  
  return null;
}

/**
 * Convert comedian slug to style name
 */
function convertComedianToStyle(comedianSlug: string): string {
  const comedianToStyleMap: Record<string, string> = {
    'jim-gaffigan': 'CONFESSIONAL',
    'demetri-martin': 'DEADPAN-WORDPLAY',
    'paul-f-tompkins': 'MOCK-COLUMNIST',
    'mitch-hedberg': 'SURREAL-ODDITY',
    'gary-gulman': 'WRY-SCIENCE',
    'robin-williams': 'MANIC-RANT',
    'dave-barry': 'MOCK-LOGIC',
    'augusten-burroughs': 'BLUNT-CHAOS',
    'min-kal': 'MUNDANE-COMMENTS',
    'sim-ric': 'SURREAL-ODDITY',
    'tin-fey': 'MOCK-COLUMNIST',
    'bil-bry': 'WRY-SCIENCE',
    'jen-law': 'MANIC-RANT',
    'dav-rak': 'CONFESSIONAL',
    'dem-mar': 'DEADPAN-WORDPLAY',
  };
  
  return comedianToStyleMap[comedianSlug.toLowerCase()] || comedianSlug.toUpperCase();
}

// Salvage helper: convert common "JSON-ish" accidents into proper lines.
function salvageJSONish(line: string): string | null {
  // Pattern: "Some text": [[ "Premise" ]], "Dav_Sed": []
  const txt = line.match(/"([^"]+)"\s*:/)?.[1];
  const seedMatch = line.match(/\[\[\s*"([^"]+)"\s*\]\]/) || line.match(/\[\[([^\]]+)\]\]/);
  const legacyStyle = line.match(/"([A-Za-z_ -]+)"\s*:\s*\[\s*\]/)?.[1];
  if (!txt || !seedMatch || !legacyStyle) return null;
  const style = normalizeStyleTag(legacyStyle);
  if (!style) return null;
  const seed = (seedMatch[1] || seedMatch[2] || '').trim().replace(/^"|"$/g, '');
  if (!seed) return null;
  return `${txt.trim()} [[${seed}]] [[${style}]]`;
}

// Salvage helper: convert {{ }} format to [[ ]] format
function salvageCurlyBraces(line: string): string | null {
  // Pattern: "Some text {{ Premise }} {{ STYLE }}"
  const curlyMatch = line.match(/^(.*?)\s*\{\{\s*([^}]+)\s*\}\}\s*\{\{\s*([^}]+)\s*\}\}\s*$/);
  if (!curlyMatch) {
    console.log('🔧 salvageCurlyBraces: No match for line:', line);
    return null;
  }
  
  const text = curlyMatch[1].trim();
  const seed = curlyMatch[2].trim();
  const styleRaw = curlyMatch[3].trim();
  
  console.log('🔧 salvageCurlyBraces: Matched - text:', text, 'seed:', seed, 'styleRaw:', styleRaw);
  
  const style = normalizeStyleTag(styleRaw);
  if (!style) {
    console.log('🔧 salvageCurlyBraces: Invalid style:', styleRaw);
    return null;
  }
  
  const result = `${text} [[${seed}]] [[${style}]]`;
  console.log('🔧 salvageCurlyBraces: Converted to:', result);
  return result;
}

/**
 * Utility to sanitize a block of model text output into canonical lines.
 * Filters out lines with invalid styles and trims whitespace noise.
 */
export function sanitizeWhimsyTextOutput(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Try direct parsing first
      const direct = parseWhimsyLine(s);
      if (direct) return direct;
      
      // Try salvage from curly braces format {{ }}
      const curlySalvage = salvageCurlyBraces(s);
      if (curlySalvage) return parseWhimsyLine(curlySalvage);
      
      // Try salvage from JSON-ish format
      const jsonSalvage = salvageJSONish(s);
      if (jsonSalvage) return parseWhimsyLine(jsonSalvage);
      
      return null;
    })
    .filter((x): x is NonNullable<ReturnType<typeof parseWhimsyLine>> => !!x)
    .map(({ text, seed, style }) => `${text} [[${seed}]] [[${style}]]`);
}

/**
 * Convert the AI JSON into TemplateDoc[] (flat list of text blocks).
 * Enforces strict schema validation - fails loudly instead of salvaging silently.
 */
export function aiJSONToTemplateDocs(json: AIResponseJSON): TemplateDoc[] {
  // Basic schema checks - fail loudly if structure is missing
  if (!json || typeof json !== 'object') {
    throw new Error("AI returned non-object response. Enable JSON mode or try again.");
  }

  // Check for empty object (model couldn't produce valid JSON)
  if (Object.keys(json).length === 0) {
    throw new Error("AI returned empty object - model could not produce valid JSON. Try again or switch models.");
  }

  // Require v5.3 structured format
  if (!Array.isArray(json.premise) || !Array.isArray(json.seed_words) || !Array.isArray(json.words)) {
    throw new Error("AI JSON missing required keys (premise, seed_words, words). Expected structured format.");
  }

  // Enforce quotas
  if (json.premise.length < 6 || json.premise.length > 10) {
    throw new Error(`Premise lines out of quota (expected 6–10, got ${json.premise.length}).`);
  }

  if (json.seed_words.length < 3) {
    throw new Error(`Need ≥3 seed words (got ${json.seed_words.length}).`);
  }

  // Ensure each seed word has at least 3 lines (relaxed for transition period)
  const byWord = new Map((json.words as Array<{word: string, lines: string[]}>).map(w => [w.word, w]));
  for (const word of json.seed_words as string[]) {
    const entry = byWord.get(word);
    if (!entry || !Array.isArray(entry.lines) || entry.lines.length < 3) {
      throw new Error(`Seed word "${word}" missing at least 3 lines (got ${entry?.lines?.length || 0}).`);
    }
  }

  // Convert to TemplateDocs
  const docs: TemplateDoc[] = [];
  const pushLine = (line: string) => {
    const trimmed = (line || "").trim();
    if (!trimmed) return;
    docs.push({
      id: `ai-${nanoid()}`,
      text: trimmed, // Required by TemplateDoc interface
      createdInSessionId: "ai-generated",
      blocks: [{ kind: "text", text: trimmed }],
    } as TemplateDoc);
  };

  // Process premise lines
  (json.premise as string[]).forEach(pushLine);
  
  // Process word-specific lines
  (json.words as Array<{word: string, lines: string[]}>).forEach(wordObj => {
    wordObj.lines.forEach(pushLine);
  });

  return docs;
}

/**
 * Convert the AI text format into TemplateDoc[] (flat list of text blocks).
 * Parses structured text format with Premise and Word sections and inline metadata tags.
 */
export function aiTextToTemplateDocs(text: string, originalTopic: string, modelUsed: string): TemplateDoc[] {
  console.log('🔧 aiTextToTemplateDocs: Processing raw text:', text.substring(0, 200) + '...');
  
  const docs: TemplateDoc[] = [];
  
  // Split into lines and filter out empty lines and section headers
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line && 
      !line.startsWith('**') && // Skip section headers like **Premise**
      !line.match(/^[A-Z][a-z]+_[A-Z][a-z]+\)$/) && // Skip attribution lines like (Tin_Fey)
      !line.includes('(Author_Initials)') // Skip template attribution placeholders
    );
    
  console.log('🔧 aiTextToTemplateDocs: Filtered lines:', lines.length);
  console.log('🔧 aiTextToTemplateDocs: Sample lines:', lines.slice(0, 3));
  
  lines.forEach(line => {
    // Use the new parseWhimsyLine function to extract seed and style
    const parsed = parseWhimsyLine(line);
    
    if (parsed) {
      const { text: cleanLine, seed, style } = parsed;
      
      docs.push({
        id: `ai-${nanoid()}`,
        text: cleanLine, // Required by TemplateDoc interface
        createdInSessionId: "ai-generated",
        blocks: [{ kind: "text", text: cleanLine }],
        meta: {
          aspect: seed, // Store the seed word as aspect
          style: style, // Store the style
          sourceWord: seed, // Keep for backward compatibility
          section: seed === 'premise' ? 'premise' : 'word',
          originalTopic,
          modelUsed,
          seedWords: [seed],
          humorStyle: style,
          generationTimestamp: Date.now(),
          aiGenerated: true
        }
      } as TemplateDoc);
    }
  });
  
  return docs;
}


/**
 * Sends TemplateDocs through your existing pipeline and yields EphemeralPrompts.
 * - Uses existing template processing pipeline
 * - Assigns templateSignature "AI-GENERATED" and a randomSeed for persistence/cleanup.
 */
export async function realizeAIDocsToEphemeral(
  docs: TemplateDoc[],
  ctx?: { words: any[]; phrases: any[] }
): Promise<EphemeralPrompt[]> {
  console.log('🔄 AI Generation: Starting realization of', docs.length, 'docs');
  console.log('🔄 AI Generation: Context has', ctx?.words?.length || 0, 'words and', ctx?.phrases?.length || 0, 'phrases');
  
  // Validate input
  if (!docs || docs.length === 0) {
    console.warn('⚠️ AI Generation: No docs provided');
    return [];
  }

  // Check if context is meaningful
  const hasContext = ctx && (ctx.words?.length > 0 || ctx.phrases?.length > 0);
  if (!hasContext) {
    console.warn('⚠️ AI Generation: Empty context - templates may not realize properly');
    console.warn('⚠️ AI Generation: Consider ingesting some phrases first to provide context');
  }

  // Process all docs in parallel instead of sequentially
  const processedDocs = await Promise.allSettled(
    docs.map(async (doc, index) => {
      try {
        console.log(`🔄 AI Generation: Processing doc ${index + 1}/${docs.length}:`, doc.id);
        
        // Step 1: Convert to unified template format
        const unified = convertTemplateDocToUnified(doc);
        console.log(`🔄 AI Generation: Converted doc ${doc.id} to unified template with`, unified.tokens.length, 'tokens');
        
        // Step 2: Realize template with existing logic
        // Provide fallback word bank if context is empty
        const wordBank: Record<string, string[]> = hasContext ? {} : {
          NOUN: ['life', 'world', 'time', 'way', 'day', 'man', 'thing', 'woman', 'child', 'government'],
          VERB: ['be', 'have', 'do', 'say', 'get', 'make', 'go', 'know', 'take', 'see'],
          ADJ: ['good', 'new', 'first', 'last', 'long', 'great', 'little', 'own', 'other', 'old'],
          ADV: ['very', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few']
        };
        
        const realized = await realizeTemplate({
          tpl: unified,
          ctx: ctx || { words: [], phrases: [] },
          lockedSet: new Set(),
          wordBank: wordBank
        });
        
        console.log(`🔄 AI Generation: Realized doc ${doc.id}:`, realized.surface ? `"${realized.surface.substring(0, 50)}..."` : 'EMPTY');
        
        if (!realized.surface || realized.surface.trim().length === 0) {
          console.warn(`⚠️ AI Generation: Doc ${doc.id} produced empty result`);
          return null; // Skip empty results
        }
        
        // Step 3: Create ephemeral prompt
        const ep: EphemeralPrompt = {
          templateId: doc.id,
          templateSignature: "AI-GENERATED",
          text: realized.surface,
          bindings: [], // AI prompts don't have slot bindings
          randomSeed: `r-${nanoid()}`,
          sourcePhraseIds: undefined,
          sourceChunkIds: undefined,
          meta: doc.meta // Preserve the aspect, style, and other metadata
        };
        
        console.log(`✅ AI Generation: Successfully created ephemeral prompt for doc ${doc.id}`);
        return ep;
      } catch (error) {
        console.error(`❌ AI Generation: Failed to realize AI template doc ${doc.id}:`, error);
        return null;
      }
    })
  );

  // Filter out failed/null results
  const successfulResults = processedDocs.filter((result): result is PromiseFulfilledResult<EphemeralPrompt> => 
    result.status === 'fulfilled' && result.value !== null
  );
  
  const failedResults = processedDocs.filter(result => 
    result.status === 'rejected' || (result.status === 'fulfilled' && result.value === null)
  );

  console.log(`🔄 AI Generation: Results - ${successfulResults.length} successful, ${failedResults.length} failed`);
  
  if (failedResults.length > 0) {
    console.warn('⚠️ AI Generation: Some docs failed to realize:', failedResults.map(r => 
      r.status === 'rejected' ? `rejected: ${r.reason}` : 'empty result'
    ));
  }

  const eps: EphemeralPrompt[] = successfulResults.map(result => result.value);

  // Step 4: Persist AI ephemeral prompts (survive sessions)
  if (eps.length > 0) {
    AIEphemeralStore.addMany(eps);
    console.log(`✅ AI Generation: Persisted ${eps.length} ephemeral prompts`);
  } else {
    console.warn('⚠️ AI Generation: No prompts to persist - all realizations failed');
  }

  return eps;
}
