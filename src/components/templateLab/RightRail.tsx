import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { TemplateRecord } from '../../lib/templateStore';
import type { PromptGenerationProfile } from '../../types';
import type { TemplateLabStore } from './templateLabStore';

type RightRailProps = {
  preview: TemplateLabStore['preview'];
  onPreview: () => void;
  templates: TemplateRecord[];
  profileDraft: PromptGenerationProfile | null;
  activeProfileId: string | null;
  profiles: PromptGenerationProfile[];
  onTemplateLoad: (template: TemplateRecord) => void;
  onTemplateDelete: (template: TemplateRecord) => void;
  onProfileSelect: (profileId: string | null) => void;
  onProfileChange: (patch: Partial<PromptGenerationProfile>) => void;
  onProfileDuplicate: (profileId: string) => void;
  onProfileDelete: (profileId: string) => void;
  onProfileSave: () => void;
  onProfilePinnedToggle: (profileId: string) => void;
  onProfileCreate: () => void;
};

const RightRail: React.FC<RightRailProps> = ({
  preview,
  onPreview,
  templates,
  profileDraft,
  activeProfileId,
  profiles,
  onTemplateLoad,
  onTemplateDelete,
  onProfileSelect,
  onProfileChange,
  onProfileDuplicate,
  onProfileDelete,
  onProfileSave,
  onProfilePinnedToggle,
  onProfileCreate
}) => {
  const [tab, setTab] = useState<'preview' | 'history' | 'profiles'>('preview');

  const activeProfile = useMemo(
    () => (activeProfileId ? profiles.find(profile => profile.id === activeProfileId) ?? null : null),
    [activeProfileId, profiles]
  );

  return (
    <div className="flex h-full flex-col">
      <nav className="flex border-b border-slate-800">
        <TabButton label="Preview" active={tab === 'preview'} onClick={() => setTab('preview')} />
        <TabButton label="History" active={tab === 'history'} onClick={() => setTab('history')} />
        <TabButton label="Profiles" active={tab === 'profiles'} onClick={() => setTab('profiles')} />
      </nav>
      <div className="flex-1 overflow-y-auto">
        {tab === 'preview' && (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Preview</h3>
              <button
                type="button"
                onClick={onPreview}
                className="rounded bg-blue-500 px-3 py-1 text-xs text-white transition hover:bg-blue-400"
              >
                Run Again
              </button>
            </div>
            {preview.status === 'idle' && (
              <p className="text-xs text-slate-500">Generate to see sample output with current settings.</p>
            )}
            {preview.status === 'running' && (
              <p className="text-xs text-blue-300">Generating preview...</p>
            )}
            {preview.status === 'error' && (
              <p className="text-xs text-red-400">Error: {preview.error}</p>
            )}
            {preview.status === 'success' && (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-200">
                  {preview.text}
                </div>
                <p className="text-xs text-slate-500">
                  Seed: {preview.seed || 'None'} · Logs: {preview.logs.length}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-2 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Saved Templates</h3>
            {!templates.length && <p className="text-xs text-slate-500">No templates saved yet.</p>}
            <ul className="space-y-2">
              {templates.map(template => (
                <li key={template.id} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
                  <button
                    type="button"
                    onClick={() => onTemplateLoad(template)}
                    className="block w-full truncate px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800/70"
                  >
                    {template.displayText || '(untitled template)'}
                  </button>
                  <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
                    <span>Updated {new Date(template.updatedAt).toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => onTemplateDelete(template)}
                      className="text-red-300 transition hover:text-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'profiles' && (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Profiles</h3>
              <button
                type="button"
                onClick={onProfileCreate}
                className="rounded bg-blue-500 px-3 py-1 text-xs text-white transition hover:bg-blue-400"
              >
                New Profile
              </button>
            </div>
            <div className="space-y-2">
              {profiles.map(profile => (
                <button
                  key={profile.id}
                  onClick={() => onProfileSelect(profile.id)}
                  className={clsx(
                    'w-full rounded border px-3 py-2 text-left text-sm transition',
                    activeProfileId === profile.id
                      ? 'border-blue-500 bg-blue-500/20 text-blue-100'
                      : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800/70'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span>{profile.name}</span>
                    {profile.pinned && <span className="text-xs text-yellow-300">Pinned</span>}
                  </div>
                </button>
              ))}
            </div>
            {profileDraft && (
              <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                <div>
                  <label className="block text-xs text-slate-400">Name</label>
                  <input
                    value={profileDraft.name}
                    onChange={event => onProfileChange({ name: event.target.value })}
                    className="mt-1 w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400">Seed</label>
                  <input
                    value={profileDraft.seed}
                    onChange={event => onProfileChange({ seed: event.target.value })}
                    className="mt-1 w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onProfileDuplicate(profileDraft.id)}
                      className="text-blue-300 transition hover:text-blue-100"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => onProfilePinnedToggle(profileDraft.id)}
                      className="text-amber-300 transition hover:text-amber-100"
                    >
                      {profileDraft.pinned ? 'Unpin' : 'Pin'}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onProfileSave}
                      className="text-emerald-300 transition hover:text-emerald-100"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => onProfileDelete(profileDraft.id)}
                      className="text-red-300 transition hover:text-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {activeProfile && activeProfile.id === profileDraft.id && (
                  <p className="text-xs text-slate-500">
                    Last used {activeProfile.lastUsedAt ? new Date(activeProfile.lastUsedAt).toLocaleString() : 'never'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

type TabButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

const TabButton: React.FC<TabButtonProps> = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={clsx(
      'flex-1 border-b px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition',
      active ? 'border-blue-400 bg-blue-500/10 text-blue-200' : 'border-transparent text-slate-500 hover:text-slate-200'
    )}
  >
    {label}
  </button>
);

export default RightRail;
