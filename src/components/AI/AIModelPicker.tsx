import React from "react";
import { useAISettings, type AIModelId } from "../../lib/ai/AISettings";

const OPTIONS: { id: AIModelId; label: string; pricing: string }[] = [
  // Cheapest options first
  { id: "openai:gpt-4o-mini", label: "OpenAI — GPT-4o Mini", pricing: "$0.15/$0.60 per 1M tokens" },
  { id: "anthropic:claude-3-haiku", label: "Anthropic — Claude 3 Haiku", pricing: "$0.25/$1.25 per 1M tokens" },
  { id: "openai:gpt-4o", label: "OpenAI — GPT-4o", pricing: "$5/$15 per 1M tokens" },
  { id: "anthropic:claude-3.5-sonnet", label: "Anthropic — Claude 3.5 Sonnet", pricing: "$3/$15 per 1M tokens" },
  { id: "anthropic:claude-3-opus", label: "Anthropic — Claude 3 Opus", pricing: "$15/$75 per 1M tokens" },
  { id: "local:whimsy", label: "Local — Whimsy (Free)", pricing: "Free (no API cost)" },
];

export function AIModelPicker(props: { className?: string }) {
  const { model, setModel, suggestionCount, setSuggestionCount } = useAISettings();

  return (
    <div className={`flex flex-wrap items-center gap-3 ${props.className || ""}`}>
      <label className="text-sm font-medium">AI Model</label>
      <select
        className="border rounded px-2 py-1 min-w-[280px]"
        value={model}
        onChange={(e) => setModel(e.target.value as any)}
      >
        {OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} — {o.pricing}
          </option>
        ))}
      </select>

      <label className="text-sm font-medium">Count</label>
      <input
        type="number"
        className="w-20 border rounded px-2 py-1"
        min={1}
        max={200}
        value={suggestionCount}
        onChange={(e) => setSuggestionCount(Number(e.target.value))}
      />
    </div>
  );
}
