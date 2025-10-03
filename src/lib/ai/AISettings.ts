import { create } from "zustand";

export type AIModelId =
  | "openai:gpt-4o"
  | "openai:gpt-4o-mini"
  | "anthropic:claude-3.5-sonnet"
  | "anthropic:claude-3-opus"
  | "anthropic:claude-3-haiku"
  | "local:whimsy";

type AISettingsState = {
  model: AIModelId;
  suggestionCount: number;
  rememberKeys: boolean;
  passphrase?: string;
  setModel: (m: AIModelId) => void;
  setSuggestionCount: (n: number) => void;
  setRememberKeys: (b: boolean) => void;
  setPassphrase: (p?: string) => void;
};

export const useAISettings = create<AISettingsState>((set) => ({
  model: "openai:gpt-4o-mini", // Default to cheapest option
  suggestionCount: 40,
  rememberKeys: false,
  passphrase: undefined,
  setModel: (m) => set({ model: m }),
  setSuggestionCount: (n) => set({ suggestionCount: Math.max(1, Math.min(200, n)) }),
  setRememberKeys: (b) => set({ rememberKeys: b }),
  setPassphrase: (p) => set({ passphrase: p }),
}));
