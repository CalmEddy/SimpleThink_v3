import type { AIModel, AIResponse } from "../AIService";

const OPENAI_URL = (import.meta as any).env?.VITE_OPENAI_BASE_URL || "/api/openai";

export class OpenAIModel implements AIModel {
  constructor(public id: any) {}

  async generateJSON(prompt: string | { systemPrompt: string; fewShotExamples: string; userRequest: string }, opts: { apiKey?: string }): Promise<AIResponse> {
    if (!opts.apiKey) throw new Error("OpenAI API key not set. Add it in AI Keys.");

    // Handle both string and structured prompt formats
    let messages: Array<{ role: string; content: string }>;
    let isTextFormat: boolean;

    if (typeof prompt === 'string') {
      // Legacy string format
      isTextFormat = prompt.includes('**Premise to expand:**') && !prompt.includes('```json');
      messages = [{ role: "user", content: prompt }];
    } else {
      // New structured format - only include assistant message if there are actual few-shot examples
      isTextFormat = prompt.systemPrompt.includes('**Premise to expand:**') && !prompt.systemPrompt.includes('```json');
      messages = [
        { role: "system", content: prompt.systemPrompt }
      ];
      
      // Only add assistant message if there are actual few-shot examples
      if (prompt.fewShotExamples && prompt.fewShotExamples.trim().length > 0) {
        messages.push({ role: "assistant", content: prompt.fewShotExamples });
      }
      
      messages.push({ role: "user", content: prompt.userRequest });
    }

    console.log('🔧 OpenAI: isTextFormat =', isTextFormat);
    console.log('🔧 OpenAI: Using structured prompt =', typeof prompt !== 'string');
    console.log('🔧 OpenAI: Messages count =', messages.length);

    const body = {
      model: this.modelIdToWire(),
      messages,
      temperature: 0.9,
      // Repetition controls that keep style variety while preventing example bleed-through
      presence_penalty: 0.7,
      frequency_penalty: 0.4,
      // Only enforce JSON mode if not requesting text format
      ...(isTextFormat ? {} : { response_format: { type: "json_object" } }),
    };

    console.log('🔧 OpenAI: Request body (without content):', {
      model: body.model,
      temperature: body.temperature,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      hasResponseFormat: 'response_format' in body,
      messageCount: messages.length
    });

    const res = await fetch(`${OPENAI_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI error: ${res.status} ${t}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    
    console.log('🔧 OpenAI: Response data:', data);
    console.log('🔧 OpenAI: Extracted text:', text);
    
    // Return as-is for format detection to handle
    return text;
  }

  private modelIdToWire() {
    switch (this.id) {
      case "openai:gpt-4o": return "gpt-4o";
      case "openai:gpt-4o-mini": return "gpt-4o-mini";
      case "openai:gpt-4.1-mini": return "gpt-4.1-mini"; // Keep for backward compatibility
      default: return "gpt-4o";
    }
  }
}
