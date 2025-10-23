import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { SemanticGraphLite } from '../../lib/semanticGraphLite';
import type { TemplateRecord } from '../../lib/templateStore';
import { useActiveNodesWithGraph } from '../../contexts/ActiveNodesContext';
import {
  useTemplateLabStore,
  LabToken,
  LibrarySection,
  TemplateLabStore
} from './templateLabStore';
import { TemplateStore } from '../../lib/templateStore';
import {
  ensureDefaultProfileExists,
  listSessionProfiles,
  addSessionProfile,
  updateSessionProfile,
  removeSessionProfile,
  duplicateProfile,
  toggleProfilePinned
} from '../../lib/sessionProfiles';
import TemplateLabToolbar from './TemplateLabToolbar';
import LibraryPanel from './LibraryPanel';
import BuilderCanvas, { SelectionToolbar } from './BuilderCanvas';
import RightRail from './RightRail';
import NotificationStack from './NotificationStack';
import TokenPreview from './TokenPreview';
import MutatorControls from './MutatorControls';

type DragPayload =
  | { type: 'token'; id: string }
  | { type: 'library'; section: LibrarySection; ids: string[] }
  | { type: 'history'; template: TemplateRecord };

interface TemplateLabProps {
  graph: SemanticGraphLite;
  sessionId?: string;
  onClose?: () => void;
}

const useStore = <T,>(selector: (state: TemplateLabStore) => T) => useTemplateLabStore(selector);

const TemplateLab: React.FC<TemplateLabProps> = ({ graph, sessionId, onClose }) => {
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { ctx, contextFrame } = useActiveNodesWithGraph(graph);
  const effectiveSessionId = sessionId ?? contextFrame?.sessionId ?? '__global__';

  const initialized = useStore(state => state.initialized);
  const tokens = useStore(state => state.tokens);
  const selection = useStore(state => state.selection);
  const library = useStore(state => state.library);
  const libraryFilters = useStore(state => state.libraryFilters);
  const librarySelection = useStore(state => state.librarySelection);
  const preview = useStore(state => state.preview);
  const notifications = useStore(state => state.notifications);
  const pinned = useStore(state => state.pinned);
  const dirty = useStore(state => state.dirty);
  const profileDraft = useStore(state => state.profileDraft);
  const activeProfileId = useStore(state => state.activeProfileId);

  const initialize = useStore(state => state.initialize);
  const setContextLibrary = useStore(state => state.setContextLibrary);
  const setTemplates = useStore(state => state.setTemplates);
  const setProfiles = useStore(state => state.setProfiles);

  const toggleLibrarySelection = useStore(state => state.toggleLibrarySelection);
  const clearLibrarySelection = useStore(state => state.clearLibrarySelection);
  const setLibraryFilter = useStore(state => state.setLibraryFilter);
  const addTokensFromLibrary = useStore(state => state.addTokensFromLibrary);

  const setSelection = useStore(state => state.setSelection);
  const toggleSelection = useStore(state => state.toggleSelection);
  const clearSelection = useStore(state => state.clearSelection);
  const moveSelection = useStore(state => state.moveSelection);
  const duplicateSelection = useStore(state => state.duplicateSelection);
  const removeSelection = useStore(state => state.removeSelection);
  const updateSlot = useStore(state => state.updateSlot);
  const updateLiteral = useStore(state => state.updateLiteral);
  const addLiteral = useStore(state => state.addLiteral);
  const reorderToken = useStore(state => state.reorderToken);

  const pushUndo = useStore(state => state.pushUndo);
  const undo = useStore(state => state.undo);
  const redo = useStore(state => state.redo);

  const setPinned = useStore(state => state.setPinned);
  const runPreview = useStore(state => state.runPreview);
  const saveTemplate = useStore(state => state.saveTemplate);
  const loadTemplate = useStore(state => state.loadTemplate);
  const setProfileDraft = useStore(state => state.setProfileDraft);
  const setActiveProfile = useStore(state => state.setActiveProfile);
  const notify = useStore(state => state.notify);
  const dismissNotification = useStore(state => state.dismissNotification);

  useEffect(() => {
    setContextLibrary({
      words: ctx.words,
      chunks: ctx.chunks,
      phrases: ctx.phrases
    });
  }, [ctx.words, ctx.chunks, ctx.phrases, setContextLibrary]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const templates = await TemplateStore.listAll();
      const ensured = ensureDefaultProfileExists(effectiveSessionId);
      const profileList = listSessionProfiles(effectiveSessionId);
      const profiles = profileList.length ? profileList : [ensured];

      if (cancelled) return;
      if (!initialized) {
        initialize({
          sessionId: effectiveSessionId,
          templates,
          profiles
        });
      } else {
        setTemplates(templates);
        setProfiles(profiles);
      }
    };

    refresh();

    const handler = () => refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('prompter:templates-changed', handler);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('prompter:templates-changed', handler);
      }
    };
  }, [effectiveSessionId, initialized, initialize, setTemplates, setProfiles]);

  const handleDragStart = (event: DragStartEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    if (payload) setActiveDrag(payload);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    const overId = (event.over?.id as string | undefined) ?? null;

    if (!payload) {
      setActiveDrag(null);
      return;
    }

    if (payload.type === 'token') {
      if (overId && overId !== payload.id) {
        pushUndo();
        reorderToken(payload.id, overId);
      }
    }

    if (payload.type === 'library') {
      pushUndo();
      const targetIndex = overId ? tokens.findIndex(token => token.id === overId) : tokens.length;
      addTokensFromLibrary(
        payload.section,
        payload.ids,
        targetIndex < 0 ? tokens.length : targetIndex
      );
    }

    if (payload.type === 'history') {
      pushUndo();
      loadTemplate(payload.template);
    }

    setActiveDrag(null);
  };

  const handleAddLiteral = () => {
    const input = window.prompt('Literal text to insert?');
    if (input && input.trim()) {
      pushUndo();
      addLiteral(input.trim());
    }
  };

  const handlePreview = async () => {
    await runPreview({ words: ctx.words ?? [] });
  };

  const handleSave = async () => {
    if (!tokens.length) {
      notify('error', 'Add tokens before saving');
      return;
    }
    await saveTemplate();
  };

  const overlayToken = useMemo(() => {
    if (activeDrag?.type !== 'token') return null;
    return tokens.find(token => token.id === activeDrag.id) ?? null;
  }, [activeDrag, tokens]);

  const handleMoveLeft = () => {
    if (!selection.length) return;
    const indices = selection
      .map(id => tokens.findIndex(token => token.id === id))
      .filter(index => index >= 0)
      .sort((a, b) => a - b);
    if (!indices.length) return;
    const target = Math.max(0, indices[0] - 1);
    pushUndo();
    moveSelection(target);
  };

  const handleMoveRight = () => {
    if (!selection.length) return;
    const indices = selection
      .map(id => tokens.findIndex(token => token.id === id))
      .filter(index => index >= 0)
      .sort((a, b) => a - b);
    if (!indices.length) return;
    const target = Math.min(tokens.length, indices[indices.length - 1] + 2);
    pushUndo();
    moveSelection(target);
  };

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <TemplateLabToolbar
        onClose={onClose}
        onSave={handleSave}
        onPreview={handlePreview}
        onUndo={undo}
        onRedo={redo}
        onAddLiteral={handleAddLiteral}
        pinned={pinned}
        onTogglePinned={() => setPinned(!pinned)}
        dirty={dirty}
        activeProfileName={
          activeProfileId
            ? library.profiles.find(profile => profile.id === activeProfileId)?.name ?? 'Custom'
            : 'None'
        }
      />

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 px-6 pb-6">
          <div className="col-span-3 flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/80">
            <LibraryPanel
              library={library}
              filters={libraryFilters}
              selection={librarySelection}
              onFilter={setLibraryFilter}
              onToggleSelection={toggleLibrarySelection}
              onClearSelection={clearLibrarySelection}
              onUseSelection={(section, ids) => {
                if (!ids.length) return;
                pushUndo();
                addTokensFromLibrary(section, ids);
              }}
            />
          </div>

          <div className="col-span-6 flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/70">
            <div className="flex-1 overflow-y-auto pr-2">
              <SortableContext items={tokens.map(token => token.id)} strategy={verticalListSortingStrategy}>
                <BuilderCanvas
                  tokens={tokens}
                  selection={selection}
                  onToggle={toggleSelection}
                  onSelectAll={ids => setSelection(ids)}
                  onClearSelection={clearSelection}
                  onUpdateSlot={updateSlot}
                  onUpdateLiteral={updateLiteral}
                />
              </SortableContext>
              <SelectionToolbar
                selection={selection.map(id => tokens.find(token => token.id === id)).filter(Boolean) as LabToken[]}
                onDuplicate={() => {
                  if (!selection.length) return;
                  pushUndo();
                  duplicateSelection();
                }}
                onDelete={() => {
                  if (!selection.length) return;
                  pushUndo();
                  removeSelection();
                }}
                onMoveLeft={handleMoveLeft}
                onMoveRight={handleMoveRight}
              />
              <MutatorControls profile={profileDraft} onChange={setProfileDraft} />
            </div>
          </div>

          <div className="col-span-3 rounded-xl border border-slate-800 bg-slate-900/80">
            <RightRail
              preview={preview}
              onPreview={handlePreview}
              templates={library.templates}
              profileDraft={profileDraft}
              activeProfileId={activeProfileId}
              profiles={library.profiles}
              onTemplateLoad={template => {
                pushUndo();
                loadTemplate(template);
              }}
              onTemplateDelete={async template => {
                await TemplateStore.remove(template.id);
                setTemplates(await TemplateStore.listAll());
              }}
              onProfileSelect={setActiveProfile}
              onProfileChange={patch => setProfileDraft(patch)}
              onProfileDuplicate={profileId => {
                const clone = duplicateProfile(effectiveSessionId, profileId, 'Copy');
                if (clone) {
                  const refreshed = listSessionProfiles(effectiveSessionId);
                  setProfiles(refreshed);
                  setActiveProfile(clone.id);
                  notify('success', `Duplicated profile "${clone.name}"`);
                }
              }}
              onProfileDelete={profileId => {
                removeSessionProfile(effectiveSessionId, profileId);
                const refreshed = listSessionProfiles(effectiveSessionId);
                setProfiles(refreshed);
                if (activeProfileId === profileId) {
                  setActiveProfile(refreshed[0]?.id ?? null);
                }
              }}
              onProfileSave={() => {
                if (!profileDraft) return;
                updateSessionProfile(effectiveSessionId, profileDraft.id, profileDraft);
                const refreshed = listSessionProfiles(effectiveSessionId);
                setProfiles(refreshed);
                notify('success', 'Profile updated');
              }}
              onProfilePinnedToggle={profileId => {
                toggleProfilePinned(effectiveSessionId, profileId);
                const refreshed = listSessionProfiles(effectiveSessionId);
                setProfiles(refreshed);
              }}
              onProfileCreate={() => {
                const name = window.prompt('New profile name');
                if (!name) return;
                const base = ensureDefaultProfileExists(effectiveSessionId);
                const created = addSessionProfile(effectiveSessionId, {
                  ...base,
                  name
                } as any);
                const refreshed = listSessionProfiles(effectiveSessionId);
                setProfiles(refreshed);
                setActiveProfile(created.id);
                notify('success', `Created profile "${name}"`);
              }}
            />
          </div>
        </div>

        <DragOverlay>
          {activeDrag?.type === 'token' && overlayToken && <TokenPreview token={overlayToken} />}
          {activeDrag?.type === 'library' && (
            <div className="rounded-full bg-blue-500/90 px-3 py-1 text-sm text-white shadow-lg">
              {activeDrag.ids.length} item{activeDrag.ids.length > 1 ? 's' : ''} from {formatSection(activeDrag.section)}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <NotificationStack notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
};

function formatSection(section: LibrarySection): string {
  switch (section) {
    case 'words':
      return 'Words';
    case 'chunks':
      return 'Chunks';
    case 'phrases':
      return 'Phrases';
    case 'templates':
      return 'Templates';
    case 'profiles':
      return 'Profiles';
    default:
      return section;
  }
}

export default TemplateLab;
