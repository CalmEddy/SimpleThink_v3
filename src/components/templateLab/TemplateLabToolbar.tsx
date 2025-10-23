import React from 'react';
import clsx from 'clsx';

interface TemplateLabToolbarProps {
  onClose?: () => void;
  onSave: () => void | Promise<void>;
  onPreview: () => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onAddLiteral: () => void;
  pinned: boolean;
  onTogglePinned: () => void;
  dirty: boolean;
  activeProfileName: string;
}

const TemplateLabToolbar: React.FC<TemplateLabToolbarProps> = ({
  onClose,
  onSave,
  onPreview,
  onUndo,
  onRedo,
  onAddLiteral,
  pinned,
  onTogglePinned,
  dirty,
  activeProfileName
}) => (
  <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4 backdrop-blur">
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Workspace</p>
      <h1 className="text-xl font-semibold text-white">Template Lab</h1>
      <p className="mt-1 text-xs text-slate-500">
        Session / Profile: <span className="text-slate-200">{activeProfileName}</span>
      </p>
    </div>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onUndo}
        className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700/80"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRedo}
        className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700/80"
      >
        Redo
      </button>
      <button
        type="button"
        onClick={onAddLiteral}
        className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700/80"
      >
        + Literal
      </button>
      <button
        type="button"
        onClick={onTogglePinned}
        className={clsx(
          'rounded-lg border px-3 py-2 text-sm transition',
          pinned
            ? 'border-yellow-400 bg-yellow-500/80 text-slate-900'
            : 'border-slate-700 bg-slate-800/70 text-slate-200 hover:bg-slate-700/80'
        )}
      >
        {pinned ? 'Pinned' : 'Pin'}
      </button>
      <button
        type="button"
        onClick={onPreview}
        className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400"
      >
        Test
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty}
        className={clsx(
          'rounded-lg px-4 py-2 text-sm font-semibold transition',
          dirty ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-slate-800/70 text-slate-400'
        )}
      >
        Save
      </button>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="ml-4 rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700/80"
        >
          Close
        </button>
      ) : null}
    </div>
  </header>
);

export default TemplateLabToolbar;
