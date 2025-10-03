import React, { useState } from "react";
import { saveKey, forgetAll } from "../../lib/ai/KeyVault";
import { useAISettings } from "../../lib/ai/AISettings";

export function AIKeysModal(props: { open: boolean; onClose: () => void }) {
  const { rememberKeys, setRememberKeys, passphrase, setPassphrase } = useAISettings();
  const [openAIKey, setOpenAIKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSave() {
    setBusy(true);
    setMsg(null);
    try {
      await saveKey("openai", openAIKey.trim(), rememberKeys, passphrase);
      await saveKey("anthropic", anthropicKey.trim(), rememberKeys, passphrase);
      setMsg("Saved!");
    } catch (e: any) {
      setMsg(e?.message || "Failed to save keys");
    } finally {
      setBusy(false);
    }
  }

  return !props.open ? null : (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
      <div className="bg-white rounded-2xl shadow-xl p-5 w-[560px]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">AI Keys</h2>
          <button className="text-gray-500 hover:text-black" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block">OpenAI API Key</label>
            <input
              type="password"
              className="w-full border rounded px-3 py-2"
              placeholder="sk-..."
              value={openAIKey}
              onChange={(e) => setOpenAIKey(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium block">Anthropic API Key</label>
            <input
              type="password"
              className="w-full border rounded px-3 py-2"
              placeholder="anthropic-api-key"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="remember"
              type="checkbox"
              checked={rememberKeys}
              onChange={(e) => setRememberKeys(e.target.checked)}
            />
            <label htmlFor="remember" className="text-sm">
              Remember keys in browser (encrypted)
            </label>
          </div>

          {rememberKeys && (
            <div>
              <label className="text-sm font-medium block">Encryption Passphrase</label>
              <input
                type="password"
                className="w-full border rounded px-3 py-2"
                placeholder="Choose a passphrase"
                value={passphrase || ""}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Used to encrypt/decrypt keys with AES-GCM in your browser.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-gray-600">{msg}</div>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded bg-gray-200" onClick={() => forgetAll()}>
                Forget All
              </button>
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                disabled={busy}
                onClick={onSave}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-500 space-y-2">
            <p>
              <strong>Tip:</strong> You can also set API keys in multiple ways:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Environment variables: <code>VITE_OPENAI_API_KEY</code> / <code>VITE_ANTHROPIC_API_KEY</code></li>
              <li>External file: Create <code>keys.json</code> in project root (see <code>keys.json.example</code>)</li>
              <li>This modal (stored encrypted in browser)</li>
            </ul>
            <p>
              <strong>For development:</strong> Use <code>keys.json</code> file (it's gitignored and won't be committed).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
