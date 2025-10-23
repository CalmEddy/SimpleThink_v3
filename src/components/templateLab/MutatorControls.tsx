import React from 'react';
import type { PromptGenerationProfile, POS } from '../../types';

type MutatorControlsProps = {
  profile: PromptGenerationProfile | null;
  onChange: (patch: Partial<PromptGenerationProfile>) => void;
};

const POS_OPTIONS: POS[] = [
  'NOUN',
  'VERB',
  'ADJ',
  'ADV',
  'ADP',
  'DET',
  'PRON',
  'PROPN',
  'AUX',
  'CCONJ'
];

const SUMMARY_POS: POS[] = ['NOUN', 'VERB', 'ADJ', 'ADV'];

const MutatorControls: React.FC<MutatorControlsProps> = ({ profile, onChange }) => {
  if (!profile) {
    return (
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
        Select or create a profile to configure mutators.
      </div>
    );
  }

  const handleToggle =
    (key: keyof PromptGenerationProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ [key]: event.currentTarget.checked } as Partial<PromptGenerationProfile>);
    };

  const handleNumber =
    (key: keyof PromptGenerationProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ [key]: Number(event.currentTarget.value) } as Partial<PromptGenerationProfile>);
    };

  const handlePosRandomChange = (pos: POS, value: number) => {
    onChange({
      posRandomP: {
        ...profile.posRandomP,
        [pos]: value
      }
    });
  };

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Mutator Controls
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Configure selection mutators for the active profile. Changes are saved with the profile.
        </p>
      </div>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Core Toggles</h4>
        <ToggleRow
          label="Jitter Mutator"
          description="Adds light randomness to slot selection."
          checked={profile.useJitter}
          onChange={handleToggle('useJitter')}
        >
          <Slider
            label="Jitter Strength"
            value={profile.jitterP}
            min={0}
            max={100}
            step={5}
            disabled={!profile.useJitter}
            onChange={value => onChange({ jitterP: value })}
          />
        </ToggleRow>

        <ToggleRow
          label="Auto Bind"
          description="Automatically bind matching lemmas to repeated slots."
          checked={profile.useAutoBind}
          onChange={handleToggle('useAutoBind')}
        />

        <ToggleRow
          label="Ensure 2 Randomization"
          description="Guarantee at least two randomized slots when available."
          checked={profile.useEnsure2}
          onChange={handleToggle('useEnsure2')}
        />

        <ToggleRow
          label="Randomize Nouns"
          description="Allow noun slots to pick from broader concept pools."
          checked={profile.useRandNouns}
          onChange={handleToggle('useRandNouns')}
        />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          Slot Randomization
        </h4>
        <ToggleRow
          label="Limit Randomized Slots"
          description="Restrict how many slots are randomized per generation."
          checked={profile.useMaxRandomization}
          onChange={handleToggle('useMaxRandomization')}
        >
          <Slider
            label="Max Random Slots"
            value={profile.maxRandomSlots}
            min={1}
            max={10}
            step={1}
            disabled={!profile.useMaxRandomization}
            onChange={value => onChange({ maxRandomSlots: value })}
          />
        </ToggleRow>

        <ToggleRow
          label="Position Targeting"
          description="Apply randomization to a specific slot position."
          checked={profile.usePositionBasedRandom}
          onChange={handleToggle('usePositionBasedRandom')}
        >
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Target POS</span>
              <select
                value={profile.targetPOS}
                onChange={event =>
                  onChange({ targetPOS: event.currentTarget.value as PromptGenerationProfile['targetPOS'] })
                }
                disabled={!profile.usePositionBasedRandom}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 focus:border-blue-500 focus:outline-none"
              >
                {POS_OPTIONS.map(pos => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Target Slot</span>
              <input
                type="number"
                min={1}
                value={profile.targetPosition}
                disabled={!profile.usePositionBasedRandom}
                onChange={handleNumber('targetPosition')}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>
        </ToggleRow>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          POS Randomization Weights
        </h4>
        <p className="text-xs text-slate-500">
          Adjust how often specific parts of speech are randomized (percent chance per slot).
        </p>
        <div className="space-y-3">
          {SUMMARY_POS.map(pos => (
            <Slider
              key={pos}
              label={pos}
              value={profile.posRandomP[pos] ?? 0}
              min={0}
              max={100}
              step={5}
              onChange={value => handlePosRandomChange(pos, value)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

type ToggleRowProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  children?: React.ReactNode;
};

const ToggleRow: React.FC<ToggleRowProps> = ({ label, description, checked, onChange, children }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-blue-500"
      />
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-slate-200">{label}</span>
        {description ? <span className="text-xs text-slate-500">{description}</span> : null}
      </div>
    </label>
    {children ? <div className="mt-3">{children}</div> : null}
  </div>
);

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, onChange, disabled }) => (
  <label className="flex flex-col gap-2 text-xs text-slate-300">
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="text-slate-400">{value}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={event => onChange(Number(event.currentTarget.value))}
      className="accent-blue-500"
    />
  </label>
);

export default MutatorControls;
