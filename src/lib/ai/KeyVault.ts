import { nanoid } from "nanoid";

/**
 * Lightweight AES-GCM encryption for API keys.
 * - If user doesn't choose "Remember", keys are held in-memory only.
 * - If "Remember", encrypted blob stored in localStorage.
 * NOTE: Frontend encryption can't fully secure secrets, but this reduces casual leakage.
 */

type Provider = "openai" | "anthropic";

type VaultState = {
  memory: Record<Provider, string | undefined>;
  remembered: boolean;
};

const VAULT_NS = "ai_key_vault.v1";
const DEFAULT_SALT_KEY = "ai_key_vault.salt";

let state: VaultState = {
  memory: { openai: undefined, anthropic: undefined },
  remembered: false,
};

function getSalt(): Uint8Array {
  let saltB64 = localStorage.getItem(DEFAULT_SALT_KEY);
  if (!saltB64) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltB64 = btoa(String.fromCharCode(...salt));
    localStorage.setItem(DEFAULT_SALT_KEY, saltB64);
  }
  const bin = atob(saltB64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.buffer,
      iterations: 120_000,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptString(s: string, passphrase: string) {
  const salt = getSalt();
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(s);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
  const blob = {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(ct))),
    id: nanoid(),
  };
  return JSON.stringify(blob);
}

async function decryptString(payload: string, passphrase: string) {
  const salt = getSalt();
  const key = await deriveKey(passphrase, salt);
  const blob = JSON.parse(payload);
  const iv = Uint8Array.from(atob(blob.iv), (c: string) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(blob.data), (c: string) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}

export async function saveKey(provider: Provider, key: string, remember: boolean, passphrase?: string) {
  state.memory[provider] = key;
  state.remembered = remember;
  if (remember && passphrase) {
    const existing = JSON.parse(localStorage.getItem(VAULT_NS) || "{}");
    existing[provider] = await encryptString(key, passphrase);
    localStorage.setItem(VAULT_NS, JSON.stringify(existing));
  }
}

export async function loadKey(provider: Provider, passphrase?: string): Promise<string | undefined> {
  // 1) env overrides (best for dev)
  const envKey =
    (provider === "openai" && (import.meta as any).env?.VITE_OPENAI_API_KEY) ||
    (provider === "anthropic" && (import.meta as any).env?.VITE_ANTHROPIC_API_KEY);
  if (envKey) return envKey;

  // 2) memory
  if (state.memory[provider]) return state.memory[provider];

  // 3) localStorage (if remembered)
  const raw = localStorage.getItem(VAULT_NS);
  if (!raw || !passphrase) return undefined;
  try {
    const obj = JSON.parse(raw);
    if (!obj[provider]) return undefined;
    const k = await decryptString(obj[provider], passphrase);
    state.memory[provider] = k;
    return k;
  } catch {
    return undefined;
  }
}

export function forgetAll() {
  state = { memory: { openai: undefined, anthropic: undefined }, remembered: false };
  localStorage.removeItem(VAULT_NS);
}

export type { Provider };
