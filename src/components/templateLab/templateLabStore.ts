import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  MorphFeature,
  PhraseChunk,
  PhraseNode,
  PhraseToken,
  POS,
  PromptGenerationProfile,
  TemplateDoc,
  TemplateBlock,
  PhraseBlock,
  WordNode
} from '../../types';
import type { TemplateRecord } from '../../lib/templateStore';
import { TemplateStore } from '../../lib/templateStore';
import { ensureHydrated } from '../../lib/ensureHydrated';
import { convertTemplateDocToUnified, parseTextPatternsToUTA } from '../../lib/composer';
import { realizeTemplate } from '../../lib/fillTemplate';
import { RandomizationConfigManager, SeededRNG } from '../../lib/randomization';
import { wordBank } from '../../lib/templates';

export type LabTokenKind = 'slot' | 'literal';

export type LibrarySection = 'words' | 'chunks' | 'phrases' | 'templates' | 'profiles';

export interface LabTokenBase {
  id: string;
  kind: LabTokenKind;
  source: LibrarySection | 'canvas' | 'literal';
  groupId?: string;
  locked?: boolean;
}

export interface LabSlotToken extends LabTokenBase {
  kind: 'slot';
  pos: POS;
  morph?: MorphFeature | null;
  bindId?: string | null;
  fallbackLiteral?: string | null;
  pinned?: boolean;
  label?: string;
}

export interface LabLiteralToken extends LabTokenBase {
  kind: 'literal';
  text: string;
}

export type LabToken = LabSlotToken | LabLiteralToken;

export interface LabNotification {
  id: string;
  type: 'info' | 'success' | 'error';
  message: string;
}

export interface LabPreviewState {
  status: 'idle' | 'running' | 'success' | 'error';
  text?: string;
  logs: string[];
  error?: string;
  seed?: string;
  generatedAt?: number;
}

interface LibrarySelectionState {
  words: Set<string>;
  chunks: Set<string>;
  phrases: Set<string>;
  templates: Set<string>;
  profiles: Set<string>;
}

export interface TemplateLabState {
  initialized: boolean;
  sessionId: string | null;
  currentDocId: string;
  tokens: LabToken[];
  pinned: boolean;
  dirty: boolean;
  selection: string[];
  hoverIndex: number | null;
  undoStack: LabSnapshot[];
  redoStack: LabSnapshot[];
  libraryFilters: Record<LibrarySection, string>;
  librarySelection: LibrarySelectionState;
  library: {
    words: WordNode[];
    chunks: PhraseChunk[];
    phrases: PhraseNode[];
    templates: TemplateRecord[];
    profiles: PromptGenerationProfile[];
  };
  activeProfileId: string | null;
  profileDraft: PromptGenerationProfile | null;
  profileDirty: boolean;
  preview: LabPreviewState;
  notifications: LabNotification[];
  saving: boolean;
}

export interface TemplateLabActions {
  initialize(payload: InitializePayload): void;
  setContextLibrary(payload: ContextPayload): void;
  setTemplates(templates: TemplateRecord[]): void;
  setProfiles(profiles: PromptGenerationProfile[]): void;
  toggleLibrarySelection(section: LibrarySection, id: string, multi: boolean): void;
  clearLibrarySelection(section: LibrarySection): void;
  setLibraryFilter(section: LibrarySection, value: string): void;
  addTokensFromLibrary(section: LibrarySection, ids: string[], position?: number): void;
  addLiteral(text: string, position?: number): void;
  insertTokens(tokens: LabToken[], position?: number): void;
  reorderToken(activeId: string, overId: string): void;
  moveSelection(targetIndex: number): void;
  updateToken(id: string, patch: Partial<Omit<LabToken, 'id' | 'kind'>>): void;
  updateSlot(id: string, patch: Partial<Omit<LabSlotToken, 'id' | 'kind'>>): void;
  updateLiteral(id: string, text: string): void;
  setSelection(ids: string[]): void;
  toggleSelection(id: string): void;
  clearSelection(): void;
  removeSelection(): void;
  duplicateSelection(): void;
  setPinned(next: boolean): void;
  setProfileDraft(patch: Partial<PromptGenerationProfile>): void;
  setActiveProfile(profileId: string | null): void;
  syncProfileToDraft(profileId: string | null): void;
  undo(): void;
  redo(): void;
  pushUndo(): void;
  resetDirty(): void;
  runPreview(ctx: { words: WordNode[] }): Promise<void>;
  saveTemplate(): Promise<void>;
  loadTemplate(record: TemplateRecord): Promise<void>;
  notify(type: LabNotification['type'], message: string): void;
  dismissNotification(id: string): void;
}

export type TemplateLabStore = TemplateLabState & TemplateLabActions;

interface InitializePayload {
  sessionId: string | null;
  doc?: TemplateDoc | null;
  templates?: TemplateRecord[];
  profiles?: PromptGenerationProfile[];
}

interface ContextPayload {
  words?: WordNode[];
  chunks?: PhraseChunk[];
  phrases?: PhraseNode[];
}

interface LabSnapshot {
  tokens: LabToken[];
  pinned: boolean;
  selection: string[];
  profileDraft: PromptGenerationProfile | null;
  activeProfileId: string | null;
}

const cloneTokens = (tokens: LabToken[]): LabToken[] =>
  tokens.map(token => ({ ...token }));

const cloneProfile = (profile: PromptGenerationProfile | null): PromptGenerationProfile | null =>
  profile ? { ...profile, posRandomP: { ...profile.posRandomP } } : null;

const emptySelectionState = (): LibrarySelectionState => ({
  words: new Set(),
  chunks: new Set(),
  phrases: new Set(),
  templates: new Set(),
  profiles: new Set()
});

const snapshotState = (state: TemplateLabState): LabSnapshot => ({
  tokens: cloneTokens(state.tokens),
  pinned: state.pinned,
  selection: [...state.selection],
  profileDraft: cloneProfile(state.profileDraft),
  activeProfileId: state.activeProfileId
});

const applySnapshot = (state: TemplateLabState, snap: LabSnapshot): TemplateLabState => ({
  ...state,
  tokens: snap.tokens,
  pinned: snap.pinned,
  selection: snap.selection,
  profileDraft: snap.profileDraft,
  activeProfileId: snap.activeProfileId,
  dirty: true
});

const makeSlotToken = (pos: POS, overrides: Partial<LabSlotToken> = {}): LabSlotToken => ({
  id: nanoid(),
  kind: 'slot',
  source: 'canvas',
  pos,
  morph: null,
  bindId: null,
  fallbackLiteral: null,
  label: undefined,
  locked: false,
  pinned: false,
  ...overrides
});

const makeLiteralToken = (text: string, overrides: Partial<LabLiteralToken> = {}): LabLiteralToken => ({
  id: nanoid(),
  kind: 'literal',
  source: 'literal',
  text,
  locked: false,
  ...overrides
});

const firstPOS = (node: WordNode): POS => {
  const candidates = Array.isArray(node.pos) && node.pos.length ? node.pos : node.posPotential || [];
  const normalized = candidates.map(v => String(v).toUpperCase());
  const allowed: POS[] = [
    'NOUN',
    'VERB',
    'VERB:participle',
    'VERB:past',
    'VERB:present_3rd',
    'ADJ',
    'ADJ:comparative',
    'ADJ:superlative',
    'ADV',
    'ADP',
    'DET',
    'PRON',
    'PROPN',
    'AUX',
    'CCONJ'
  ];
  const match = normalized.find(pos => allowed.includes(pos as POS));
  return (match as POS) || 'NOUN';
};

const chunkToTokens = (chunk: PhraseChunk): LabToken[] => {
  const pattern = chunk.posPattern || '';
  const tags = pattern
    .split(/[-\s]+/g)
    .map(tag => tag.trim())
    .filter(Boolean);
  if (!tags.length) {
    return [makeLiteralToken(chunk.text || chunk.pattern || chunk.id)];
  }
  return tags.map((tag, index) =>
    makeSlotToken((tag.toUpperCase() as POS) || 'NOUN', {
      groupId: chunk.id,
      source: 'chunks',
      label: `${tag.toUpperCase()}${index + 1}`
    })
  );
};

const phraseToTokens = (phrase: PhraseNode): LabToken[] => {
  const text = phrase.text || '';
  if (!text.trim()) return [];
  const pieces = text.split(/\s+/);
  return pieces.map(piece => makeLiteralToken(piece, { source: 'phrases' }));
};

const templateRecordToDoc = async (record: TemplateRecord): Promise<TemplateDoc> => {
  const doc = record.doc;
  if (!doc) {
    const parsed = await parseTextPatternsToUTA({
      id: record.id,
      text: record.displayText ?? '',
      blocks: [
        {
          kind: 'text',
          text: record.displayText ?? ''
        }
      ] as TemplateDoc['blocks'],
      createdInSessionId: record.sessionId ?? '__global__'
    });
    return parsed;
  }
  return doc;
};

const tokensToPhraseTokens = (tokens: LabToken[]): PhraseToken[] =>
  tokens.map(token => {
    if (token.kind === 'literal') {
      return {
        text: token.text,
        lemma: token.text.toLowerCase(),
        randomize: false,
        slotLabel: null,
        pos: undefined,
        posSet: undefined,
        morph: null
      };
    }

    return {
      text: `[${token.pos}]`,
      lemma: token.pos,
      pos: token.pos,
      posSet: [token.pos],
      randomize: true,
      slotLabel: token.bindId ?? null,
      morph: token.morph ?? null
    };
  });

const tokensToDoc = (tokens: LabToken[], state: TemplateLabState): TemplateDoc => {
  const phraseTokens = tokensToPhraseTokens(tokens);

  const text = phraseTokens
    .map(token => (token.randomize ? `[${token.pos}]` : token.text))
    .join(' ')
    .trim();

  return {
    id: state.currentDocId,
    text,
    blocks: [
      {
        kind: 'phrase',
        phraseText: text,
        tokens: phraseTokens
      } as TemplateDoc['blocks'][number]
    ],
    createdInSessionId: state.sessionId ?? '__global__'
  };
};

export const useTemplateLabStore = create<TemplateLabStore>((set, get) => ({
  initialized: false,
  sessionId: null,
  currentDocId: nanoid(),
  tokens: [],
  pinned: false,
  dirty: false,
  selection: [],
  hoverIndex: null,
  undoStack: [],
  redoStack: [],
  libraryFilters: {
    words: '',
    chunks: '',
    phrases: '',
    templates: '',
    profiles: ''
  },
  librarySelection: emptySelectionState(),
  library: {
    words: [],
    chunks: [],
    phrases: [],
    templates: [],
    profiles: []
  },
  activeProfileId: null,
  profileDraft: null,
  profileDirty: false,
  preview: {
    status: 'idle',
    logs: []
  },
  notifications: [],
  saving: false,

  initialize: ({ sessionId, doc, templates = [], profiles = [] }) => {
    const baseDoc: TemplateDoc = doc ?? {
      id: nanoid(),
      text: '',
      blocks: [],
      createdInSessionId: sessionId ?? '__global__'
    };

    const tokens = docToTokens(baseDoc);
    const defaultProfile = profiles[0] ?? null;

    set({
      initialized: true,
      sessionId: sessionId ?? null,
      currentDocId: baseDoc.id,
      tokens,
      pinned: Boolean((doc as any)?.meta?.pinned),
      dirty: false,
      selection: [],
      undoStack: [],
      redoStack: [],
      librarySelection: emptySelectionState(),
      library: {
        words: [],
        chunks: [],
        phrases: [],
        templates,
        profiles
      },
      activeProfileId: defaultProfile?.id ?? null,
      profileDraft: defaultProfile ? { ...defaultProfile, posRandomP: { ...defaultProfile.posRandomP } } : null,
      profileDirty: false,
      preview: { status: 'idle', logs: [] },
      notifications: []
    });
  },

  setContextLibrary: ({ words = [], chunks = [], phrases = [] }) => {
    set(state => ({
      library: {
        ...state.library,
        words,
        chunks,
        phrases
      }
    }));
  },

  setTemplates: templates => {
    set(state => ({
      library: {
        ...state.library,
        templates
      }
    }));
  },

  setProfiles: profiles => {
    const { activeProfileId } = get();
    const active = activeProfileId ? profiles.find(profile => profile.id === activeProfileId) ?? null : null;
    set(state => ({
      library: {
        ...state.library,
        profiles
      },
      profileDraft: active ? { ...active, posRandomP: { ...active.posRandomP } } : state.profileDraft,
      activeProfileId: active ? active.id : state.activeProfileId
    }));
  },

  toggleLibrarySelection: (section, id, multi) => {
    set(state => {
      const next = new Set(state.librarySelection[section]);

      if (!multi) {
        next.clear();
      }

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return {
        librarySelection: {
          ...state.librarySelection,
          [section]: next
        }
      };
    });
  },

  clearLibrarySelection: section => {
    set(state => ({
      librarySelection: {
        ...state.librarySelection,
        [section]: new Set()
      }
    }));
  },

  setLibraryFilter: (section, value) => {
    set(state => ({
      libraryFilters: {
        ...state.libraryFilters,
        [section]: value
      }
    }));
  },

  addTokensFromLibrary: (section, ids, position) => {
    const { library } = get();
    const additions: LabToken[] = [];

    if (section === 'words') {
      ids.forEach(id => {
        const word = library.words.find(w => w.id === id);
        if (word) {
          additions.push(
            makeSlotToken(firstPOS(word), {
              source: 'words',
              fallbackLiteral: word.text
            })
          );
        }
      });
    } else if (section === 'chunks') {
      ids.forEach(id => {
        const chunk = library.chunks.find(c => c.id === id);
        if (chunk) {
          additions.push(...chunkToTokens(chunk));
        }
      });
    } else if (section === 'phrases') {
      ids.forEach(id => {
        const phrase = library.phrases.find(p => p.id === id);
        if (phrase) {
          additions.push(...phraseToTokens(phrase));
        }
      });
    } else if (section === 'templates') {
      Promise.all(
        ids.map(async id => {
          const template = library.templates.find(t => t.id === id);
          if (!template) return [];
          try {
            const doc = await templateRecordToDoc(template);
            return docToTokens(doc);
          } catch (error) {
            console.warn('[TemplateLab] Failed to load template record', error);
            return [];
          }
        })
      )
        .then(grouped => {
          const flat = grouped.flat();
          if (flat.length) {
            get().insertTokens(flat, position);
          }
        })
        .catch(error => {
          console.warn('[TemplateLab] Failed to process templates from library', error);
        });
      return;
    } else if (section === 'profiles') {
      if (ids.length) {
        get().syncProfileToDraft(ids[0]);
      }
      return;
    }

    get().insertTokens(additions, position);
  },

  addLiteral: (text, position) => {
    const token = makeLiteralToken(text);
    get().insertTokens([token], position);
  },

  insertTokens: (tokens, position) => {
    if (!tokens.length) return;
    set(state => {
      const nextTokens = [...state.tokens];
      const index = position == null ? nextTokens.length : Math.max(0, Math.min(position, nextTokens.length));

      nextTokens.splice(index, 0, ...tokens);

      return {
        tokens: nextTokens,
        dirty: true,
        selection: tokens.map(token => token.id)
      };
    });
  },

  reorderToken: (activeId, overId) => {
    set(state => {
      const from = state.tokens.findIndex(token => token.id === activeId);
      const to = state.tokens.findIndex(token => token.id === overId);
      if (from === -1 || to === -1 || from === to) return state;
      const next = [...state.tokens];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return {
        ...state,
        tokens: next,
        dirty: true
      };
    });
  },

  moveSelection: targetIndex => {
    set(state => {
      const ids = new Set(state.selection);
      if (!ids.size) return state;

      const trimmedTarget = Math.max(0, Math.min(targetIndex, state.tokens.length));
      const moving: LabToken[] = [];
      const kept: LabToken[] = [];
      let removedBeforeTarget = 0;

      state.tokens.forEach((token, index) => {
        if (ids.has(token.id)) {
          if (index < trimmedTarget) removedBeforeTarget += 1;
          moving.push(token);
        } else {
          kept.push(token);
        }
      });

      if (!moving.length) return state;

      const insertionIndex = Math.max(0, Math.min(trimmedTarget - removedBeforeTarget, kept.length));
      const nextTokens = [
        ...kept.slice(0, insertionIndex),
        ...moving,
        ...kept.slice(insertionIndex)
      ];

      return {
        ...state,
        tokens: nextTokens,
        dirty: true
      };
    });
  },

  updateToken: (id, patch) => {
    set(state => {
      const next = state.tokens.map(token => (token.id === id ? { ...token, ...patch } : token));
      return {
        ...state,
        tokens: next,
        dirty: true
      };
    });
  },

  updateSlot: (id, patch) => {
    set(state => {
      const next = state.tokens.map(token => {
        if (token.id !== id) return token;
        if (token.kind !== 'slot') return token;
        return { ...token, ...patch };
      });
      return {
        ...state,
        tokens: next,
        dirty: true
      };
    });
  },

  updateLiteral: (id, text) => {
    set(state => {
      const next = state.tokens.map(token => {
        if (token.id !== id) return token;
        if (token.kind !== 'literal') return token;
        return { ...token, text };
      });
      return {
        ...state,
        tokens: next,
        dirty: true
      };
    });
  },

  setSelection: ids => {
    set({ selection: ids });
  },

  toggleSelection: id => {
    set(state => {
      const selected = new Set(state.selection);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return {
        selection: Array.from(selected)
      };
    });
  },

  clearSelection: () => set({ selection: [] }),

  removeSelection: () => {
    const { selection } = get();
    if (!selection.length) return;
    set(state => ({
      tokens: state.tokens.filter(token => !selection.includes(token.id)),
      selection: [],
      dirty: true
    }));
  },

  duplicateSelection: () => {
    const { selection, tokens } = get();
    if (!selection.length) return;
    const map = new Map(tokens.map(token => [token.id, token]));
    const duplicates = selection
      .map(id => map.get(id))
      .filter(Boolean)
      .map(token => ({
        ...token!,
        id: nanoid()
      }));
    get().insertTokens(duplicates, undefined);
  },

  setPinned: next => set({ pinned: next, dirty: true }),

  setProfileDraft: patch => {
    set(state => {
      if (!state.profileDraft) return state;
      return {
        profileDraft: { ...state.profileDraft, ...patch },
        profileDirty: true
      };
    });
  },

  setActiveProfile: profileId => {
    const { library } = get();
    if (!profileId) {
      set({
        activeProfileId: null,
        profileDraft: null,
        profileDirty: false
      });
      return;
    }
    const profile = library.profiles.find(p => p.id === profileId) ?? null;
    set({
      activeProfileId: profile ? profile.id : null,
      profileDraft: profile ? { ...profile, posRandomP: { ...profile.posRandomP } } : null,
      profileDirty: false
    });
  },

  syncProfileToDraft: profileId => {
    const { library } = get();
    const profile = library.profiles.find(p => p.id === profileId) ?? null;
    set({
      activeProfileId: profile ? profile.id : null,
      profileDraft: profile ? { ...profile, posRandomP: { ...profile.posRandomP } } : null,
      profileDirty: false
    });
  },

  undo: () => {
    set(state => {
      if (!state.undoStack.length) return state;
      const undoStack = [...state.undoStack];
      const last = undoStack.pop()!;
      const redoStack = [...state.redoStack, snapshotState(state)];
      return {
        ...applySnapshot(state, last),
        undoStack,
        redoStack
      };
    });
  },

  redo: () => {
    set(state => {
      if (!state.redoStack.length) return state;
      const redoStack = [...state.redoStack];
      const next = redoStack.pop()!;
      const undoStack = [...state.undoStack, snapshotState(state)];
      return {
        ...applySnapshot(state, next),
        undoStack,
        redoStack
      };
    });
  },

  pushUndo: () => {
    set(state => ({
      undoStack: [...state.undoStack, snapshotState(state)],
      redoStack: []
    }));
  },

  resetDirty: () => set({ dirty: false }),

  runPreview: async ctx => {
    set(state => ({
      preview: { ...state.preview, status: 'running', logs: [], error: undefined }
    }));

    try {
      const state = get();
      const doc = tokensToDoc(state.tokens, state);
      const configManager = RandomizationConfigManager.getInstance();
      const profile = state.profileDraft;

      if (profile) {
        configManager.loadFromProfile(profile);
        if (profile.seed) {
          configManager.setSeed(profile.seed);
        }
      } else {
        configManager.updateConfig({ seed: undefined });
      }
      configManager.setLoggingEnabled(true);

      let hydrated = await ensureHydrated(doc);
      if (profile) {
        hydrated = applyProfileMutators(hydrated, profile);
      }
      const unified = convertTemplateDocToUnified(hydrated);

      const result = await realizeTemplate({
        tpl: unified,
        ctx: {
          words: ctx.words ?? []
        },
        lockedSet: new Set(),
        wordBank
      });

      set({
        preview: {
          status: 'success',
          text: result.surface,
          logs: [`Generated ${result.surface}`],
          error: undefined,
          generatedAt: Date.now(),
          seed: profile?.seed
        }
      });
    } catch (error) {
      set({
        preview: {
          status: 'error',
          logs: [],
          error: error instanceof Error ? error.message : 'Failed to generate preview'
        }
      });
    }
  },

  saveTemplate: async () => {
    const state = get();
    if (!state.tokens.length) {
      get().notify('error', 'Add tokens before saving');
      return;
    }

    set({ saving: true });

    try {
      const doc = tokensToDoc(state.tokens, state);
      const hydrated = await ensureHydrated(doc);
      const saved = await TemplateStore.save({
        sessionId: state.sessionId ?? undefined,
        doc: hydrated,
        pinned: state.pinned
      });

      get().notify('success', 'Template saved');
      get().setTemplates(await TemplateStore.listAll());
      set({
        currentDocId: saved.id,
        dirty: false,
        saving: false
      });
    } catch (error) {
      get().notify('error', error instanceof Error ? error.message : 'Failed to save template');
      set({ saving: false });
    }
  },

  loadTemplate: async record => {
    const doc = await templateRecordToDoc(record);
    const tokens = docToTokens(doc);
    set({
      currentDocId: record.id,
      tokens,
      pinned: Boolean(record.pinned),
      dirty: false,
      selection: []
    });
  },

  notify: (type, message) => {
    const id = nanoid();
    set(state => ({
      notifications: [...state.notifications, { id, type, message }]
    }));
    setTimeout(() => get().dismissNotification(id), 4000);
  },

  dismissNotification: id => {
    set(state => ({
      notifications: state.notifications.filter(notification => notification.id !== id)
    }));
  }
}));

function docToTokens(doc: TemplateDoc): LabToken[] {
  const tokens: LabToken[] = [];

  for (const block of doc.blocks ?? []) {
    if (block.kind === 'phrase') {
      for (const token of block.tokens ?? []) {
        if (token.randomize) {
          tokens.push(
            makeSlotToken((token.pos as POS) || 'NOUN', {
              source: 'canvas',
              morph: token.morph ?? null,
              bindId: token.slotLabel ?? null,
              fallbackLiteral: token.text
            })
          );
        } else {
          tokens.push(
            makeLiteralToken(token.text ?? '', {
              source: 'literal'
            })
          );
        }
      }
    } else if (block.kind === 'text') {
      const textBlock = block as TemplateDoc['blocks'][number];
      const text = (textBlock as any).text ?? '';
      if (text.trim()) {
        tokens.push(makeLiteralToken(text, { source: 'literal' }));
      }
    }
  }

  return tokens;
}

export function labTokensToDoc(tokens: LabToken[], state: TemplateLabState): TemplateDoc {
  return tokensToDoc(tokens, state);
}
function applyProfileMutators(doc: TemplateDoc, profile: PromptGenerationProfile): TemplateDoc {
  const seededRng = profile.seed ? new SeededRNG(profile.seed) : null;
  const random = () => (seededRng ? seededRng.next() : Math.random());

  const posWeights: Record<POS, number> = { ...profile.posRandomP };
  if (profile.useRandNouns) {
    posWeights.NOUN = Math.max(posWeights.NOUN ?? 0, 100);
    posWeights.PROPN = Math.max(posWeights.PROPN ?? 0, 60);
  }

  const blocks = (doc.blocks ?? []).map(block => {
    if (block.kind !== 'phrase') {
      return block;
    }

    const phrase = { ...(block as PhraseBlock) };
    const tokens = phrase.tokens.map(token => ({ ...token }));
    const randomizableIndices = tokens
      .map((token, index) => (isRandomizableToken(token) ? index : -1))
      .filter(index => index >= 0);
    const randomizableSet = new Set(randomizableIndices);
    const randomized = new Set<number>();

    tokens.forEach((token, index) => {
      if (token.randomize && randomizableSet.has(index)) {
        randomized.add(index);
      }
    });

    if (profile.useClickableSelection && profile.selectedWordIndices?.length) {
      profile.selectedWordIndices.forEach(idx => {
        if (randomizableSet.has(idx)) {
          randomized.add(idx);
        }
      });
    }

    if (profile.usePositionBasedRandom) {
      const matching = tokens
        .map((token, index) => ({ token, index }))
        .filter(({ token }) => matchesTargetPOS(token, profile.targetPOS));
      if (matching.length >= profile.targetPosition) {
        randomized.add(matching[profile.targetPosition - 1].index);
      }
    }

    tokens.forEach((token, index) => {
      if (!randomizableSet.has(index)) return;
      const probability = getMaxPosProbability(token, posWeights);
      if (probability > 0 && random() < probability / 100) {
        randomized.add(index);
      }
    });

    if (profile.useJitter && profile.jitterP > 0) {
      tokens.forEach((token, index) => {
        if (!randomizableSet.has(index) || randomized.has(index)) return;
        if (random() < profile.jitterP / 100) {
          randomized.add(index);
        }
      });
    }

    if (profile.useRandNouns) {
      tokens.forEach((token, index) => {
        if (!randomizableSet.has(index)) return;
        const base = getBasePOS(token.pos || (token.posSet && token.posSet[0]));
        if (base === 'NOUN' || base === 'PROPN') {
          randomized.add(index);
        }
      });
    }

    if (profile.regexText && profile.regexRandomizeP > 0) {
      try {
        const regex = new RegExp(profile.regexText, 'i');
        const phraseText = tokens.map(token => token.text ?? '').join(' ');
        if (regex.test(phraseText)) {
          tokens.forEach((token, index) => {
            if (!randomizableSet.has(index) || randomized.has(index)) return;
            if (random() < profile.regexRandomizeP / 100) {
              randomized.add(index);
            }
          });
        }
      } catch {
        // Ignore invalid patterns
      }
    }

    const ensureTarget = profile.useEnsure2 ? Math.min(2, randomizableSet.size) : 0;
    const maxSlots = profile.useMaxRandomization
      ? Math.max(profile.maxRandomSlots, ensureTarget)
      : undefined;

    if (maxSlots !== undefined && maxSlots >= 0) {
      const current = Array.from(randomized);
      while (current.length > maxSlots && current.length) {
        const removeIndex = Math.floor(random() * current.length);
        const removed = current.splice(removeIndex, 1)[0];
        randomized.delete(removed);
      }
    }

    if (ensureTarget > 0 && randomized.size < ensureTarget) {
      const remaining = randomizableIndices.filter(index => !randomized.has(index));
      while (randomized.size < ensureTarget && remaining.length) {
        const pickIndex = Math.floor(random() * remaining.length);
        const pick = remaining.splice(pickIndex, 1)[0];
        randomized.add(pick);
      }
    }

    const updatedTokens = tokens.map((token, index) => {
      if (!randomizableSet.has(index)) {
        return { ...token };
      }
      if (randomized.has(index)) {
        return { ...token, randomize: true };
      }
      const next = { ...token };
      next.randomize = false;
      next.slotLabel = null;
      return next;
    });

    if (profile.useAutoBind) {
      applyAutoBindLabels(updatedTokens, random, 2);
    }

    phrase.tokens = updatedTokens;
    return phrase;
  });

  return {
    ...doc,
    blocks
  };
}

function isRandomizableToken(token: PhraseToken): boolean {
  return typeof token.text === 'string' && /[A-Za-z]/.test(token.text ?? '');
}

function getBasePOS(pos?: string | null): string {
  if (!pos) return '';
  return String(pos).toUpperCase().split(':')[0];
}

function matchesTargetPOS(token: PhraseToken, target: POS): boolean {
  if (!target) return false;
  const entries: string[] = [];
  if (token.pos) entries.push(token.pos);
  if (token.posSet) entries.push(...token.posSet);
  return entries.some(entry => {
    const base = getBasePOS(entry);
    return base === target || entry === target;
  });
}

function getMaxPosProbability(token: PhraseToken, weights: Record<POS, number>): number {
  const entries: string[] = [];
  if (token.pos) entries.push(token.pos);
  if (token.posSet) entries.push(...token.posSet);
  let max = 0;
  entries.forEach(entry => {
    const asPos = entry as POS;
    if (weights[asPos] !== undefined) {
      max = Math.max(max, weights[asPos]);
    }
    const base = getBasePOS(entry) as POS;
    if (weights[base] !== undefined) {
      max = Math.max(max, weights[base]);
    }
  });
  return max;
}

function applyAutoBindLabels(tokens: PhraseToken[], random: () => number, maxGroups: number): void {
  const labels = Array.from({ length: Math.max(1, maxGroups) }, (_, idx) => String(idx + 1));
  tokens.forEach(token => {
    if (!token.randomize) {
      return;
    }
    if (random() < 0.5) {
      const labelIndex = Math.floor(random() * labels.length);
      token.slotLabel = labels[labelIndex] ?? '1';
    } else {
      token.slotLabel = token.slotLabel ?? null;
    }
  });
}
