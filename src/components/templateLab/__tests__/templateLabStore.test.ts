import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTemplateLabStore } from '../templateLabStore';
import { TemplateStore } from '../../../lib/templateStore';

const createLocalStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
};

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = createLocalStorage();
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };
}

const resetStore = () => {
  const store = useTemplateLabStore.getState();
  store.initialize({
    sessionId: '__test__',
    templates: [],
    profiles: []
  });
  store.setContextLibrary({ words: [], chunks: [], phrases: [] });
  store.setTemplates([]);
  store.setProfiles([]);
};

describe('templateLabStore', () => {
  beforeEach(() => {
    if (global.localStorage) {
      global.localStorage.clear();
    }
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('adds slot tokens when words are dropped from the library', () => {
    const store = useTemplateLabStore.getState();
    store.setContextLibrary({
      words: [
        {
          id: 'w1',
          type: 'WORD',
          text: 'river',
          lemma: 'river',
          pos: ['NOUN'],
          posPotential: ['NOUN'],
          posObserved: {},
          primaryPOS: 'NOUN',
          isPolysemousPOS: false
        } as any
      ],
      chunks: [],
      phrases: []
    });

    store.addTokensFromLibrary('words', ['w1']);

    const state = useTemplateLabStore.getState();
    expect(state.tokens).toHaveLength(1);
    expect(state.tokens[0].kind).toBe('slot');
    expect((state.tokens[0] as any).pos).toBe('NOUN');
  });

  it('syncs active profile into profileDraft when selecting profiles', () => {
    const profiles = [
      {
        id: 'profile-1',
        name: 'Default',
        createdInSessionId: '__test__',
        createdAt: Date.now(),
        useJitter: true,
        jitterP: 30,
        useAutoBind: true,
        useEnsure2: true,
        useRandNouns: false,
        useMaxRandomization: false,
        maxRandomSlots: 2,
        usePositionBasedRandom: false,
        targetPOS: 'NOUN',
        targetPosition: 1,
        useClickableSelection: false,
        selectedPhraseId: undefined,
        selectedWordIndices: [],
        posRandomP: {},
        regexText: '',
        regexRandomizeP: 0,
        useActivePool: true,
        lockedTemplateId: undefined,
        seed: '',
        pinned: false
      },
      {
        id: 'profile-2',
        name: 'Exploratory',
        createdInSessionId: '__test__',
        createdAt: Date.now(),
        useJitter: false,
        jitterP: 0,
        useAutoBind: false,
        useEnsure2: false,
        useRandNouns: false,
        useMaxRandomization: false,
        maxRandomSlots: 2,
        usePositionBasedRandom: false,
        targetPOS: 'NOUN',
        targetPosition: 1,
        useClickableSelection: false,
        selectedPhraseId: undefined,
        selectedWordIndices: [],
        posRandomP: {},
        regexText: '',
        regexRandomizeP: 0,
        useActivePool: true,
        lockedTemplateId: undefined,
        seed: '42',
        pinned: false
      }
    ] as any;

    const store = useTemplateLabStore.getState();
    store.initialize({
      sessionId: '__test__',
      templates: [],
      profiles
    });

    // default selection should pick the first profile
    expect(useTemplateLabStore.getState().profileDraft?.name).toBe('Default');

    store.setActiveProfile('profile-2');
    const state = useTemplateLabStore.getState();
    expect(state.activeProfileId).toBe('profile-2');
    expect(state.profileDraft?.name).toBe('Exploratory');
    expect(state.profileDraft?.seed).toBe('42');
  });

  it('saves templates to TemplateStore and refreshes history', async () => {
    const store = useTemplateLabStore.getState();
    store.initialize({
      sessionId: '__test__',
      templates: [],
      profiles: []
    });
    store.addLiteral('hello world');
    await store.saveTemplate();

    const allTemplates = await TemplateStore.listAll();
    expect(allTemplates.length).toBeGreaterThan(0);
    expect(allTemplates[0].displayText).toContain('hello world');
    expect(useTemplateLabStore.getState().library.templates.length).toBeGreaterThan(0);
  });

  it('undo and redo restore token order', () => {
    const store = useTemplateLabStore.getState();
    store.addLiteral('alpha');
    store.addLiteral('beta');
    const [first, second] = useTemplateLabStore.getState().tokens.map(token => token.id);

    store.pushUndo();
    store.reorderToken(second, first);

    expect(useTemplateLabStore.getState().tokens[0].id).toBe(second);

    store.undo();
    expect(useTemplateLabStore.getState().tokens[0].id).toBe(first);

    store.redo();
    expect(useTemplateLabStore.getState().tokens[0].id).toBe(second);
  });
});
