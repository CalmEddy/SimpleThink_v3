import type { EphemeralPrompt } from "../types/index.js";

const KEY = "ai_ephemeral_prompts.v1";

function loadRaw(): EphemeralPrompt[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EphemeralPrompt[]) : [];
  } catch {
    return [];
  }
}

function saveRaw(list: EphemeralPrompt[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export const AIEphemeralStore = {
  list(): EphemeralPrompt[] {
    return loadRaw();
  },

  addMany(items: EphemeralPrompt[]) {
    const cur = loadRaw();
    // de-duplicate by randomSeed
    const seeds = new Set(cur.map((x) => x.randomSeed));
    const merged = [...cur];
    for (const it of items) {
      if (!seeds.has(it.randomSeed)) {
        merged.push({ ...it, templateSignature: "AI-GENERATED" } as EphemeralPrompt);
      }
    }
    saveRaw(merged);
  },

  removeBySeed(seed: string) {
    saveRaw(loadRaw().filter((x) => x.randomSeed !== seed));
  },

  isAI(seed?: string) {
    if (!seed) return false;
    return loadRaw().some((x) => x.randomSeed === seed);
  },
};
