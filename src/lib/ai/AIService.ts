import { loadKey } from "./KeyVault";
import { getAPIKey } from "./apiKeys";
import { categorizeAIError } from "./errorHandler";
import { detectResponseFormat } from "./AITemplateGenerator";
import type { AIModelId } from "./AISettings";
import { loadWhimsicalPrompt } from './promptLoader';

function hasWhimsyGuards(s: string): boolean {
  if (!s) return false;
  const needles = [
    "AI Prompt: Whimsical Premise Expansion",
    "STRICT OUTPUT FORMAT",
    "[[SW:seed]]",
    "[[CN:comedian-slug]]"
  ];
  return needles.every(n => s.includes(n));
}

const CN_ALLOW = new Set([
  "jim-gaffigan","demetri-martin","paul-f-tompkins","mitch-hedberg",
  "gary-gulman","robin-williams","dave-barry","augusten-burroughs",
  "min-kal","sim-ric","tin-fey","bil-bry","jen-law","dav-rak","dem-mar"
]);

function validateAndFilterLines(text: string, seeds?: string[]): string {
  const seedSet = new Set<string>(["premise", ...(seeds ?? [])]);
  const lines = (text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const ok: string[] = [];
  
  console.log('🔧 validateAndFilterLines: Processing', lines.length, 'lines');
  console.log('🔧 validateAndFilterLines: Allowed seeds:', Array.from(seedSet));
  console.log('🔧 validateAndFilterLines: Allowed comedians:', Array.from(CN_ALLOW));
  
  for (const line of lines) {
    const m = line.match(/^(.+)\s\[\[SW:([a-z0-9-]+)\]\]\s\[\[CN:([a-z0-9-]+)\]\]$/);
    if (!m) {
      console.log('🔧 validateAndFilterLines: Rejected (malformed):', line);
      continue;
    }
    const [, phrase, sw, cn] = m;
    
    if (!seedSet.has(sw)) {
      console.log('🔧 validateAndFilterLines: Rejected (invalid seed):', line, '- seed:', sw);
      continue;
    }
    
    if (!CN_ALLOW.has(cn)) {
      console.log('🔧 validateAndFilterLines: Rejected (invalid comedian):', line, '- comedian:', cn);
      continue;
    }
    
    if (!phrase || phrase.length < 3) {
      console.log('🔧 validateAndFilterLines: Rejected (short phrase):', line);
      continue;
    }
    
    ok.push(`${phrase} [[SW:${sw}]] [[CN:${cn}]]`);
  }
  
  console.log('🔧 validateAndFilterLines: Kept', ok.length, 'valid lines out of', lines.length);
  return ok.join("\n");
}

export const ALLOWED_STYLES = [
  'CONFESSIONAL',
  'MOCK-LOGIC',
  'BLUNT-CHAOS',
  'SURREAL-ODDITY',
  'WRY-SCIENCE',
  'DEADPAN-WORDPLAY',
  'MANIC-RANT',
  'MOCK-COLUMNIST',
  'SARCASTIC',
  'MUNDANE-COMMENTS',
] as const;

export type AllowedStyle = typeof ALLOWED_STYLES[number];

// Map legacy style tags to canonical styles
const LEGACY_STYLE_MAP: Record<string, AllowedStyle> = {
  'DAV_SED': 'CONFESSIONAL',
  'DAV_BAR': 'MOCK-LOGIC',
  'SAM_IRB': 'SARCASTIC',
  'AUG_BURR': 'BLUNT-CHAOS',
  'MIN_KAL': 'MUNDANE-COMMENTS',
  'SIM_RIC': 'SURREAL-ODDITY',
  'TIN_FEY': 'MOCK-COLUMNIST',
  'BIL_BRY': 'WRY-SCIENCE',
  'JEN_LAW': 'MANIC-RANT',
  'DAV_RAK': 'CONFESSIONAL',
  'DEM_MAR': 'DEADPAN-WORDPLAY',
};

export function normalizeStyleTag(tag: string): AllowedStyle | null {
  if (!tag) return null;
  const t = tag.trim().toUpperCase();
  if ((ALLOWED_STYLES as readonly string[]).includes(t)) return t as AllowedStyle;
  if (t in LEGACY_STYLE_MAP) return LEGACY_STYLE_MAP[t];
  return null;
}

// Map comedian slugs to style tags
const COMEDIAN_TO_STYLE_MAP: Record<string, AllowedStyle> = {
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

/**
 * Convert comedian tags [[CN:comedian-slug]] to style tags [[ST:style]]
 */
function convertComedianTagsToStyles(text: string): string {
  return text.replace(/\[\[CN:([^\]]+)\]\]/g, (match, comedianSlug) => {
    const style = COMEDIAN_TO_STYLE_MAP[comedianSlug.toLowerCase()];
    if (style) {
      return `[[ST:${style}]]`;
    }
    // If no mapping found, keep the original CN tag
    return match;
  });
}

export type AIResponseJSON = Record<string, unknown>;
export type AIResponse = AIResponseJSON | string;

export interface AIModel {
  id: AIModelId;
  generateJSON(prompt: string | { systemPrompt: string; fewShotExamples: string; userRequest: string }, opts: { apiKey?: string }): Promise<AIResponse>;
}

export type WhimsyMode = "rotation" | "single";

export interface WhimsyRequest {
  premise: string;
  mode?: WhimsyMode;                // default: 'rotation'
  singleComedian?: string;          // required if mode === 'single'
  model?: AIModelId;                // defaults to env or sensible default
  /** Whether to return the final tag as the original [[CN:...]] comedian or mapped [[ST:...]] style */
  outputTagMode?: "comedian" | "style";
  /**
   * Optional: provide the exact lemmatized seeds to force seed-riff phase.
   * If omitted, the model will extract seeds itself per the System rules.
   * Example: ["make","hay","sun","shine"]
   */
  seeds?: string[];
  /** Quotas to prevent early stopping after premise riffs */
  minPremiseRiffs?: number;   // default 7
  minRiffsPerSeed?: number;   // default 4
  minTotalLines?: number;     // default 24 (premise + seeds)
  temperature?: number;             // defaults set below
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_output_tokens?: number;
}

async function fillPrompt(
  topic: string, 
  mode: WhimsyMode = "rotation", 
  singleComedian?: string,
  seeds?: string[],
  minPremiseRiffs: number = 7,
  minRiffsPerSeed: number = 4,
  minTotalLines: number = 24
): Promise<{ systemPrompt: string; fewShotExamples: string; userRequest: string }> {
  console.log('🔧 fillPrompt: Loading prompt for topic:', topic);
  
  // Load the canonical prompt from markdown
  const systemPrompt = await loadWhimsicalPrompt();
  console.log('🔧 fillPrompt: Loaded system prompt length:', systemPrompt.length);
  
  // Validate system prompt BEFORE proceeding
  if (!hasWhimsyGuards(systemPrompt)) {
    throw new Error(
      "Whimsy system prompt failed to load or is missing required guards. " +
      "Check that whimsical-expansion.md contains the required markers: 'AI Prompt: Whimsical Premise Expansion', 'STRICT OUTPUT FORMAT', '[[SW:seed]]', '[[CN:comedian-slug]]'"
    );
  }
  
  // Create the user request with mode-specific instructions and explicit quotas
  const userLines = [
    `Premise: ${topic.trim()}`,
    // Hard quotas to prevent early stop after premise
    `- QUOTAS: Generate at least ${minPremiseRiffs} premise riffs FIRST (use [[SW:premise]]), THEN generate at least ${minRiffsPerSeed} riffs for EACH seed word covering distinct senses. Total lines >= ${minTotalLines}. Do not stop after premise riffs.`,
    mode === "single" && singleComedian
      ? `- Use single-style mode: ${singleComedian}`
      : `- Use rotation mode.`,
    `- Output only: phrase [[SW:seed]] [[CN:comedian-slug]].`,
    `- Seed must be lemmatized, lowercase slug (a–z, 0–9, hyphen).`,
    `- Comedian must be lowercase hyphenated slug (e.g., robin-williams).`
  ];
  
  if (Array.isArray(seeds) && seeds.length) {
    userLines.push(`- Seeds (lemmatized): ${seeds.join(", ")}`);
    userLines.push(`- For EACH of these seeds, write >= ${minRiffsPerSeed} riffs spanning different meanings/usages (literal, idiom, slang, technical, cultural, historical).`);
  } else {
    userLines.push(`- After premise riffs, EXTRACT seeds (lemmatize) and write >= ${minRiffsPerSeed} riffs per seed spanning distinct meanings/usages.`);
  }
  
  const userRequest = userLines.join('\n');
  
  // Debug log (trimmed) — helps confirm the exact payload at runtime
  if (typeof window !== "undefined" && (window as any).DEBUG_WHIMSY === true) {
    const sysPreview = systemPrompt.slice(0, 200).replace(/\n/g, " ");
    const usrPreview = userRequest.slice(0, 200).replace(/\n/g, " ");
    console.log("[Whimsy] system~:", sysPreview, "| user~:", usrPreview);
  }
  
  console.log('🔧 fillPrompt: Created user request length:', userRequest.length);
  console.log('🔧 fillPrompt: System prompt validation: PASSED');
  console.log('🔧 fillPrompt: Complete system prompt preview:', systemPrompt.substring(0, 300) + '...');
  console.log('🔧 fillPrompt: Complete user request:', userRequest);
  
  return {
    systemPrompt,
    fewShotExamples: "", // No few-shots in the new clean implementation
    userRequest
  };
}

// Parse JSON strictly - no fallback extraction
function tryParseJSON(text: string): AIResponseJSON {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("AI did not return valid JSON. Enable JSON mode or try again.");
  }
}

export class AIService {
  constructor(private readonly registry: Record<AIModelId, AIModel>) {}

  static async build(): Promise<AIService> {
    const { OpenAIModel } = await import("./models/OpenAI");
    const { AnthropicModel } = await import("./models/Anthropic");
    const { LocalModel } = await import("./models/LocalModel");

    return new AIService({
      "openai:gpt-4o": new OpenAIModel("openai:gpt-4o"),
      "openai:gpt-4o-mini": new OpenAIModel("openai:gpt-4o-mini"),
      "anthropic:claude-3.5-sonnet": new AnthropicModel("anthropic:claude-3.5-sonnet"),
      "anthropic:claude-3-opus": new AnthropicModel("anthropic:claude-3-opus"),
      "anthropic:claude-3-haiku": new AnthropicModel("anthropic:claude-3-haiku"),
      "local:whimsy": new LocalModel("local:whimsy"),
    });
  }

  /**
   * Generate whimsical lines using the Whimsy Foundry prompt.
   * Returns the raw text (already in the required "phrase [[seed]] [[comedian]]" format).
   */
  async generateWhimsy(req: WhimsyRequest): Promise<string> {
    const {
      premise,
      mode = "rotation",
      singleComedian,
      // Default to a stronger style-capable model for generation
      model = "openai:gpt-4o",
      // default now keeps comedian tags so the parser can map CN→STYLE downstream
      outputTagMode = "comedian",
      seeds,
      minPremiseRiffs = 7,
      minRiffsPerSeed = 4,
      minTotalLines = 24,
      temperature: _temperature = 0.9,
      top_p: _top_p = 1.0,
      // Lower penalties → less moralizing filler, better comedic cadence
      presence_penalty: _presence_penalty = 0.2,
      frequency_penalty: _frequency_penalty = 0.0,
      max_output_tokens: _max_output_tokens = 1600,
    } = req;

    if (!premise?.trim()) {
      throw new Error("AIService.generateWhimsy: 'premise' is required.");
    }
    if (mode === "single" && !singleComedian) {
      throw new Error("AIService.generateWhimsy: 'singleComedian' is required when mode === 'single'.");
    }

    console.log('🔧 AIService: generateWhimsy called with:', { premise, model, mode, singleComedian });
    
    const provider: "openai" | "anthropic" | "local" =
      model.startsWith("openai:") ? "openai" : model.startsWith("anthropic:") ? "anthropic" : "local";

    console.log('🔧 AIService: Detected provider:', provider);

    let apiKey: string | undefined;
    
    // Try loading from external sources first
    if (provider !== "local") {
      apiKey = await getAPIKey(provider);
      console.log('🔧 AIService: API key from external source:', apiKey ? 'found' : 'not found');
      
      // Fallback to KeyVault if not found externally
      if (!apiKey) {
        apiKey = await loadKey(provider as any);
        console.log('🔧 AIService: API key from KeyVault:', apiKey ? 'found' : 'not found');
      }
    } else {
      console.log('🔧 AIService: Using local model, no API key needed');
    }
    
    try {
      const promptData = await fillPrompt(premise, mode, singleComedian, seeds, minPremiseRiffs, minRiffsPerSeed, minTotalLines);
      console.log('🔧 AIService: Generated structured prompt data');
      console.log('🔧 AIService: System prompt length:', promptData.systemPrompt.length);
      console.log('🔧 AIService: User request length:', promptData.userRequest.length);
      
      const m = this.registry[model];
      console.log('🔧 AIService: Using model:', m?.id || 'NOT FOUND');
      console.log('🔧 AIService: Model registry keys:', Object.keys(this.registry));
      
      if (!m) {
        throw new Error(`Model ${model} not found in registry. Available models: ${Object.keys(this.registry).join(', ')}`);
      }
      
      // Final validation before API call
      console.log('🔧 AIService: Final payload validation - System prompt has required guards:', hasWhimsyGuards(promptData.systemPrompt));
      console.log('🔧 AIService: User request contains quotas:', promptData.userRequest.includes('QUOTAS'));
      
      // Debug mode - show full payload if enabled
      if (typeof window !== "undefined" && (window as any).DEBUG_WHIMSY === true) {
        console.log('🔧 AIService: FULL SYSTEM PROMPT:', promptData.systemPrompt);
        console.log('🔧 AIService: FULL USER REQUEST:', promptData.userRequest);
        console.log('🔧 AIService: MODEL:', model);
      }
      
      // Pass the structured prompt data to the model (no few-shots)
      const raw = await m.generateJSON(promptData, { apiKey });
      console.log('🔧 AIService: Raw response type:', typeof raw);
      console.log('🔧 AIService: Raw response preview:', typeof raw === 'string' ? raw.substring(0, 300) + '...' : JSON.stringify(raw).substring(0, 300) + '...');
      
      // Handle both JSON and text formats
      const format = detectResponseFormat(raw);
      console.log('🔧 AIService: Detected format:', format);
      
      let result: string;
      if (format === 'json') {
        // For JSON format, we need to convert back to string for the new API
        if (typeof raw === "string") {
          const parsed = tryParseJSON(raw);
          result = JSON.stringify(parsed);
        } else {
          result = JSON.stringify(raw);
        }
      } else {
        // Return text format as-is
        result = typeof raw === 'string' ? raw : JSON.stringify(raw);
      }

      // Apply validation and tag mode conversion if needed
      const rawResult = String(result || "").trim();
      const filtered = validateAndFilterLines(rawResult, seeds);
      
      if (outputTagMode === "style") {
        return convertComedianTagsToStyles(filtered);
      }
      return filtered;
    } catch (error) {
      console.error('🔧 AIService: Error in generateWhimsy:', error);
      // Re-throw with categorized error for better user experience
      const errorInfo = categorizeAIError(error instanceof Error ? error : new Error(String(error)));
      throw new Error(errorInfo.userMessage);
    }
  }

  // Legacy method for backward compatibility
  async generateWhimsicalJSON(topic: string, model: AIModelId, _passphrase?: string): Promise<AIResponse> {
    return this.generateWhimsy({
      premise: topic,
      model: model || "openai:gpt-4o", // Use stronger default if no model specified
      mode: "rotation",
      minPremiseRiffs: 7,
      minRiffsPerSeed: 4,
      minTotalLines: 24,
      max_output_tokens: 1600,
      presence_penalty: 0.2,
      frequency_penalty: 0.0
    });
  }
}

export default AIService;