import React, { useMemo } from 'react';
import clsx from 'clsx';
import { useDraggable } from '@dnd-kit/core';
import type { TemplateRecord } from '../../lib/templateStore';
import type { PromptGenerationProfile } from '../../types';
import type { LibrarySection, TemplateLabStore } from './templateLabStore';

type LibraryPanelProps = {
  library: TemplateLabStore['library'];
  filters: TemplateLabStore['libraryFilters'];
  selection: TemplateLabStore['librarySelection'];
  onFilter: (section: LibrarySection, value: string) => void;
  onToggleSelection: (section: LibrarySection, id: string, multi: boolean) => void;
  onClearSelection: (section: LibrarySection) => void;
  onUseSelection: (section: LibrarySection, ids: string[]) => void;
};

const LibraryPanel: React.FC<LibraryPanelProps> = ({
  library,
  filters,
  selection,
  onFilter,
  onToggleSelection,
  onClearSelection,
  onUseSelection
}) => {
  const sections = useMemo<
    Array<{
      id: LibrarySection;
      title: string;
      items: any[];
      render: (item: any) => string;
    }>
  >(
    () => [
      { id: 'words', title: 'Words', items: library.words, render: (word: any) => word.text },
      {
        id: 'chunks',
        title: 'Chunks',
        items: library.chunks,
        render: (chunk: any) => chunk.text ?? chunk.pattern ?? chunk.posPattern
      },
      { id: 'phrases', title: 'Phrases', items: library.phrases, render: (phrase: any) => phrase.text },
      {
        id: 'templates',
        title: 'Saved Templates',
        items: library.templates,
        render: (template: TemplateRecord) => template.displayText || '(untitled)'
      },
      {
        id: 'profiles',
        title: 'Profiles',
        items: library.profiles,
        render: (profile: PromptGenerationProfile) => profile.name
      }
    ],
    [library]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Context Library</h2>
        <p className="mt-1 text-xs text-slate-500">Drag or multi-select via checkboxes, then drop onto the canvas.</p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-slate-900 pr-2">
        {sections.map(({ id, title, items, render }) => {
          const filter = filters[id] ?? '';
          const matching = items.filter(item => render(item).toLowerCase().includes(filter.toLowerCase()));
          const selectedIds = Array.from(selection[id]);

          return (
            <section key={id}>
              <header className="flex flex-col gap-2 bg-slate-900/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      {title}
                      <span className="ml-2 text-xs text-slate-500">{items.length}</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      {selectedIds.length
                        ? `${selectedIds.length} selected`
                        : matching.length
                          ? `${matching.length} available`
                          : 'No matches'}
                    </p>
                  </div>
                  {selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onUseSelection(id, selectedIds);
                        onClearSelection(id);
                      }}
                      className="rounded bg-blue-500 px-3 py-1 text-xs text-white transition hover:bg-blue-400"
                    >
                      Use {selectedIds.length}
                    </button>
                  )}
                </div>
                <input
                  type="search"
                  value={filter}
                  onChange={event => onFilter(id, event.target.value)}
                  placeholder="Filter..."
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                />
              </header>
              <ul className="max-h-52 overflow-y-auto">
                {!matching.length && (
                  <li className="px-4 py-3 text-xs text-slate-500">No items</li>
                )}
                {matching.map(item => {
                  const itemId = item.id ?? render(item);
                  return (
                    <LibraryRow
                      key={itemId}
                      section={id}
                      id={itemId}
                      label={render(item)}
                      selected={selection[id].has(itemId)}
                      selectionSet={selection[id]}
                      onToggle={multi => onToggleSelection(id, itemId, multi)}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};

type LibraryRowProps = {
  section: LibrarySection;
  id: string;
  label: string;
  selected: boolean;
  selectionSet: Set<string>;
  onToggle: (multi: boolean) => void;
};

const LibraryRow: React.FC<LibraryRowProps> = ({ section, id, label, selected, selectionSet, onToggle }) => {
  const selectedIds = selectionSet.size ? Array.from(selectionSet) : [id];
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `library-${section}-${id}`,
    data: {
      type: 'library',
      section,
      ids: selectedIds
    } satisfies DragPayload
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={clsx(
        'flex cursor-grab select-none items-center gap-2 border-b border-slate-900/70 px-4 py-2 text-sm transition active:cursor-grabbing',
        selected ? 'bg-blue-500/20 text-blue-100' : 'text-slate-200 hover:bg-slate-800/70'
      )}
      onClick={event => onToggle(event.shiftKey || event.metaKey || event.ctrlKey)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={event => onToggle(event.shiftKey || event.metaKey || event.ctrlKey)}
        className="rounded border-slate-700 accent-blue-500"
      />
      <span className="truncate">{label}</span>
    </li>
  );
};

type DragPayload = { type: 'library'; section: LibrarySection; ids: string[] };

export default LibraryPanel;
