/**
 * API Key Management for AI Services
 * 
 * This module handles loading API keys from multiple sources:
 * 1. Environment variables (VITE_OPENAI_API_KEY, VITE_ANTHROPIC_API_KEY)
 * 2. External keys.json file in the project root
 * 3. Browser localStorage (encrypted)
 * 4. In-app key management UI
 */

export interface APIKeys {
  openai?: string;
  anthropic?: string;
}

export interface KeysConfig {
  keys: APIKeys;
  source: 'env' | 'file' | 'storage' | 'ui';
  lastUpdated: number;
}

let keysCache: KeysConfig | null = null;

/**
 * Load API keys from external keys.json file
 */
async function loadKeysFromFile(): Promise<APIKeys | null> {
  try {
    const response = await fetch('/keys.json');
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return {
      openai: data.openai,
      anthropic: data.anthropic
    };
  } catch (error) {
    console.warn('[API Keys] Could not load keys.json:', error);
    return null;
  }
}

/**
 * Load API keys from environment variables
 */
function loadKeysFromEnv(): APIKeys {
  return {
    openai: (import.meta as any).env?.VITE_OPENAI_API_KEY,
    anthropic: (import.meta as any).env?.VITE_ANTHROPIC_API_KEY
  };
}

/**
 * Load API keys from localStorage (encrypted)
 */
function loadKeysFromStorage(): APIKeys | null {
  try {
    const raw = localStorage.getItem('ai_keys_encrypted');
    if (!raw) return null;
    
    const encrypted = JSON.parse(raw);
    // For now, return null - encrypted keys need passphrase to decrypt
    // This would be handled by the KeyVault module
    return null;
  } catch {
    return null;
  }
}

/**
 * Get API keys from all sources, prioritizing in order:
 * 1. Environment variables (highest priority)
 * 2. External keys.json file
 * 3. localStorage (encrypted)
 * 4. Manual UI entry (lowest priority)
 */
export async function loadAPIKeys(): Promise<KeysConfig> {
  // Check cache first
  if (keysCache) {
    console.log('[API Keys] Using cached keys from:', keysCache.source);
    return keysCache;
  }

  let keys: APIKeys = {};
  let source: KeysConfig['source'] = 'ui';

  // 1. Try environment variables first
  const envKeys = loadKeysFromEnv();
  console.log('[API Keys] Environment keys check:', { 
    hasOpenAI: !!envKeys.openai, 
    hasAnthropic: !!envKeys.anthropic 
  });
  
  if (envKeys.openai || envKeys.anthropic) {
    keys = envKeys;
    source = 'env';
    console.log('[API Keys] Loaded from environment variables');
  } else {
    // 2. Try external keys.json file
    const fileKeys = await loadKeysFromFile();
    console.log('[API Keys] File keys check:', { 
      hasFileKeys: !!fileKeys,
      hasOpenAI: !!(fileKeys?.openai),
      hasAnthropic: !!(fileKeys?.anthropic),
      openAIValue: fileKeys?.openai ? `${fileKeys.openai.substring(0, 10)}...` : 'none'
    });
    
    if (fileKeys && (fileKeys.openai || fileKeys.anthropic)) {
      // Check if keys are still placeholder values
      if (fileKeys.openai?.includes('your-openai-api-key-here') || 
          fileKeys.anthropic?.includes('your-anthropic-api-key-here')) {
        console.warn('[API Keys] Detected placeholder values in keys.json file!');
      }
      
      keys = fileKeys;
      source = 'file';
      console.log('[API Keys] Loaded from keys.json file');
    } else {
      // 3. Try localStorage
      const storageKeys = loadKeysFromStorage();
      if (storageKeys && (storageKeys.openai || storageKeys.anthropic)) {
        keys = storageKeys;
        source = 'storage';
        console.log('[API Keys] Loaded from localStorage');
      }
    }
  }

  const config: KeysConfig = {
    keys,
    source,
    lastUpdated: Date.now()
  };

  console.log('[API Keys] Final config:', {
    source: config.source,
    hasOpenAI: !!config.keys.openai,
    hasAnthropic: !!config.keys.anthropic
  });

  // Cache the result
  keysCache = config;
  return config;
}

/**
 * Get a specific API key for a provider
 */
export async function getAPIKey(provider: keyof APIKeys): Promise<string | undefined> {
  const config = await loadAPIKeys();
  return config.keys[provider];
}

/**
 * Clear the keys cache (useful when keys are updated)
 */
export function clearKeysCache(): void {
  console.log('[API Keys] Clearing keys cache');
  keysCache = null;
}

/**
 * Reload API keys (clears cache and reloads)
 */
export async function reloadAPIKeys(): Promise<KeysConfig> {
  clearKeysCache();
  return loadAPIKeys();
}

/**
 * Check if API keys are available
 */
export async function hasAPIKeys(): Promise<boolean> {
  const config = await loadAPIKeys();
  return !!(config.keys.openai || config.keys.anthropic);
}

/**
 * Get the source of the loaded keys
 */
export async function getKeysSource(): Promise<KeysConfig['source']> {
  const config = await loadAPIKeys();
  return config.source;
}
