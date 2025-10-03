import type { AIModel, AIResponse } from "../AIService";

const ANTHROPIC_URL = (import.meta as any).env?.VITE_ANTHROPIC_BASE_URL || "/api/anthropic/messages";

export class AnthropicModel implements AIModel {
  constructor(public id: any) {}

  async generateJSON(prompt: string | { systemPrompt: string; fewShotExamples: string; userRequest: string }, opts: { apiKey?: string }): Promise<AIResponse> {
    if (!opts.apiKey) throw new Error("Anthropic API key not set. Add it in AI Keys.");

    // Handle both string and structured prompt formats
    let messages: Array<{ role: string; content: string }>;
    
    if (typeof prompt === 'string') {
      // Legacy string format
      messages = [{ role: "user", content: prompt }];
    } else {
      // New structured format - Anthropic doesn't support system messages in the same way
      // So we'll combine system prompt and few-shots into the user message
      const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.fewShotExamples}\n\n${prompt.userRequest}`;
      messages = [{ role: "user", content: combinedPrompt }];
    }

    const body = {
      model: this.modelIdToWire(),
      max_tokens: 2048,
      temperature: 0.9,
      messages,
    };

    console.log('[Anthropic] Making request to:', ANTHROPIC_URL);
    console.log('[Anthropic] Request body:', JSON.stringify(body, null, 2));
    console.log('[Anthropic] API key present:', !!opts.apiKey);
    console.log('[Anthropic] API key prefix:', opts.apiKey?.substring(0, 10) + '...');

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey!,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    console.log('[Anthropic] Response status:', res.status);
    console.log('[Anthropic] Response headers:', Object.fromEntries(res.headers.entries()));

    if (!res.ok) {
      const t = await res.text();
      console.error('[Anthropic] Error response:', t);
      throw new Error(`Anthropic error: ${res.status} ${t}`);
    }

    const data = await res.json();
    const text =
      data?.content?.[0]?.type === "text" ? data?.content?.[0]?.text : data?.content?.map((c: any) => c.text || "").join("\n");
    return text ?? "";
  }

  private modelIdToWire() {
    switch (this.id) {
      case "anthropic:claude-3-haiku": return "claude-3-haiku-20240307";
      case "anthropic:claude-3.5-sonnet": return "claude-3-5-sonnet-20240620";
      case "anthropic:claude-3-opus": return "claude-3-opus-20240229";
      default: return "claude-3-5-sonnet-20240620";
    }
  }
}
