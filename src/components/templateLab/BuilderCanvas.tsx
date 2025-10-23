import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import type { LabToken } from './templateLabStore';

type BuilderCanvasProps = {
  tokens: LabToken[];
  selection: string[];
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onUpdateSlot: (id: string, patch: Partial<LabToken>) => void;
  onUpdateLiteral: (id: string, text: string) => void;
};

const BuilderCanvas: React.FC<BuilderCanvasProps> = ({
  tokens,
  selection,
  onToggle,
  onSelectAll,
  onClearSelection,
  onUpdateSlot,
  onUpdateLiteral
}) => {
  const handleBackgroundClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClearSelection();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto" onClick={handleBackgroundClick}>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Template</h3>
            <p className="text-xs text-slate-500">Drag tokens to reorder. Drop items between capsules to insert.</p>
          </div>
          <button
            type="button"
            onClick={() => onSelectAll(tokens.map(token => token.id))}
            className="text-xs text-slate-400 transition hover:text-slate-200"
          >
            Select all
          </button>
        </div>
        <div
          className={clsx(
            'min-h-[260px] rounded-xl border border-dashed p-3',
            tokens.length ? 'border-slate-700' : 'border-slate-800'
          )}
        >
          {!tokens.length ? (
            <div className="text-center text-sm text-slate-500">
              Drag words, chunks, phrases, or saved templates here to begin.
            </div>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {tokens.map(token => (
                <SortableToken
                  key={token.id}
                  token={token}
                  selected={selection.includes(token.id)}
                  onToggle={() => onToggle(token.id)}
                  onUpdateSlot={onUpdateSlot}
                  onUpdateLiteral={onUpdateLiteral}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

type SortableTokenProps = {
  token: LabToken;
  selected: boolean;
  onToggle: () => void;
  onUpdateSlot: (id: string, patch: Partial<LabToken>) => void;
  onUpdateLiteral: (id: string, text: string) => void;
};

const SortableToken: React.FC<SortableTokenProps> = ({
  token,
  selected,
  onToggle,
  onUpdateSlot,
  onUpdateLiteral
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: token.id
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners} className="list-none">
      <TokenChip
        token={token}
        selected={selected}
        dragging={isDragging}
        onToggle={onToggle}
        onMorphChange={morph => onUpdateSlot(token.id, { morph: morph as any })}
        onLiteralChange={text => onUpdateLiteral(token.id, text)}
      />
    </li>
  );
};

type TokenChipProps = {
  token: LabToken;
  selected?: boolean;
  dragging?: boolean;
  onToggle?: () => void;
  onMorphChange?: (morph: string | null) => void;
  onLiteralChange?: (text: string) => void;
};

const TokenChip: React.FC<TokenChipProps> = ({
  token,
  selected = false,
  dragging = false,
  onToggle,
  onMorphChange,
  onLiteralChange
}) => (
  <div
    className={clsx(
      'flex select-none items-center gap-2 rounded-full border px-3 py-2 text-sm transition',
      selected ? 'border-blue-400 bg-blue-500/20 text-blue-100' : 'border-slate-700 bg-slate-800/70 text-slate-200',
      dragging && 'opacity-70'
    )}
    onClick={event => {
      event.stopPropagation();
      onToggle?.();
    }}
  >
    {token.kind === 'slot' ? (
      <>
        <span className="font-semibold">{token.pos}</span>
        <select
          value={token.morph ?? 'base'}
          onChange={event => onMorphChange?.(event.target.value === 'base' ? null : event.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
        >
          <option value="base">base</option>
          <option value="past">past</option>
          <option value="participle">participle</option>
          <option value="present_3rd">present_3rd</option>
          <option value="comparative">comparative</option>
          <option value="superlative">superlative</option>
          <option value="plural">plural</option>
        </select>
      </>
    ) : (
      <input
        value={token.text}
        onChange={event => onLiteralChange?.(event.target.value)}
        className="bg-transparent text-sm outline-none"
      />
    )}
  </div>
);

type SelectionToolbarProps = {
  selection: LabToken[];
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
};

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selection,
  onDuplicate,
  onDelete,
  onMoveLeft,
  onMoveRight
}) => {
  if (!selection.length) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
      <span>
        {selection.length} token{selection.length > 1 ? 's' : ''} selected
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onMoveLeft}
          className="rounded bg-slate-800/70 px-2 py-1 text-slate-200 transition hover:bg-slate-700/80"
        >
          Move Left
        </button>
        <button
          type="button"
          onClick={onMoveRight}
          className="rounded bg-slate-800/70 px-2 py-1 text-slate-200 transition hover:bg-slate-700/80"
        >
          Move Right
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded bg-slate-800/70 px-2 py-1 text-slate-200 transition hover:bg-slate-700/80"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded bg-red-500/80 px-2 py-1 text-white transition hover:bg-red-500"
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export type { SelectionToolbarProps };
export { SelectionToolbar };
export default BuilderCanvas;
