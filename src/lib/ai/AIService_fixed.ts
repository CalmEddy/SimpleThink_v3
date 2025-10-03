import { loadKey } from "./KeyVault";
import { getAPIKey } from "./apiKeys";
import { categorizeAIError } from "./errorHandler";
import { detectResponseFormat } from "./AITemplateGenerator";
import type { AIModelId } from "./AISettings";

// SYSTEM_PROMPT (Whimsy Foundry v5.7)
// NOTE: This replaces prior Whimsy system text only. No pipeline or method changes.
const SYSTEM_PROMPT = `
AI Prompt: Whimsical Premise Expansion (Whimsy Foundry v5.7) +
OBJECTIVE
Take a given premise and generate short, high-variance, whimsical commentary lines. Premise riffs are about the whole phrase. Seed-word riffs are fully de-contextualized and explore the word across unrelated domains. Do not restate the premise. +
STRICT OUTPUT FORMAT
Each line MUST be:
phrase [[seed]] [[style]]
Rules:
- No headers, numbering, JSON, or extra formatting.
- seed = "Premise" for premise riffs; otherwise the LEMMATIZED base form of the seed word (e.g., "earned"→"earn", "kids"→"kid").
- style ∈ { Dav_Sed, Dav_Bar, Sam_Irb, Aug_Burr, Min_Kal, Sim_Ric, Tin_Fey, Bil_Bry, Jen_Law, Dav_Rak, Dem_Mar }. +
STYLE ROTATION (HARD RULES)
- Treat styles like a shuffled deck. Deal without replacement until all styles have appeared at least once (if line budget allows).
- Max 2 uses per style until all styles have appeared.
- Never use the same style on consecutive lines.
- Prefer underused styles as you progress. +
SEED WORD EXTRACTION
- Retain only meaningful content words: nouns, adjectives, distinctive verbs.
- EXCLUDE glue/stop/pronoun/aux/common verbs: is, a, an, the, of, to, for, in, on, at, by, and, or, but, not, I, me, you, we, they, he, she, it, do, does, did, don't, won't, will, can, can't, have, has, had, be, am, are, was, were, been, being.
- Lemmatize all retained seeds to base form. +
SEED WORD COMMENTARY (DE-CONTEXTUALIZED)
- Treat each seed word as a standalone topic. Once writing seed riffs, IGNORE the premise entirely. Do NOT reference or echo the premise in seed riffs.
- Identify the word's MAJOR DISTINCT SENSES/USES (literal, metaphorical, idiomatic, slang, technical, cultural, historical).
- Write at least ONE riff per distinct sense; if the word has many senses, allocate MORE riffs to cover them.
- Include at least ONE riff with WORDPLAY for EACH seed (pun, rhyme, idiom twist, cliché subversion, double meaning). Do not add extra labels—wordplay should be evident in the line itself.
- Vary domains intentionally (science, tech, art, sports, religion, law, medicine, cooking, pop culture, philosophy, history, mythology, internet culture). +
PREMISE RIFTS
- Produce 5–7 premise riffs that play with the premise's idea (no scaffolding or meta prefaces). +
LINE QUALITY
- High surprise and specificity; avoid stock templates (e.g., "X is just Y with Z").
- Mix short and medium lengths; keep lines punchy.

---

**Premise to expand:** {{PREMISE}}
`;

export type AIResponseJSON = Record<string, unknown>;
export type AIResponse = AIResponseJSON | string;

export interface AIModel {
  id: AIModelId;
  generateJSON(prompt: string, opts: { apiKey?: string }): Promise<AIResponse>;
}

async function fillPrompt(topic: string): Promise<string> {
  // Use the new v5.7 SYSTEM_PROMPT instead of loading from markdown file
  return SYSTEM_PROMPT.replace(/\{\{PREMISE\}\}/g, topic.trim());
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

  async generateWhimsicalJSON(topic: string, model: AIModelId, passphrase?: string): Promise<AIResponse> {
    const provider: "openai" | "anthropic" | "local" =
      model.startsWith("openai:") ? "openai" : model.startsWith("anthropic:") ? "anthropic" : "local";

    let apiKey: string | undefined;
    
    // Try loading from external sources first
    if (provider !== "local") {
      apiKey = await getAPIKey(provider);
      
      // Fallback to KeyVault if not found externally
      if (!apiKey) {
        apiKey = await loadKey(provider as any, passphrase);
      }
    }
    
    try {
      const p = await fillPrompt(topic);
      const m = this.registry[model];
      const raw = await m.generateJSON(p, { apiKey });
      
      // Handle both JSON and text formats
      const format = detectResponseFormat(raw);
      
      if (format === 'json') {
        // Defensive: some providers wrap content as string
        if (typeof raw === "string") return tryParseJSON(raw);
        return raw;
      } else {
        // Return text format as-is
        return raw;
      }
    } catch (error) {
      // Re-throw with categorized error for better user experience
      const errorInfo = categorizeAIError(error instanceof Error ? error : new Error(String(error)));
      throw new Error(errorInfo.userMessage);
    }
  }
}
