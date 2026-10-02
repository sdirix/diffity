import { updateSettings, useSettings, type Settings, type ThemeSetting } from '../../lib/preferences';
import { ChoiceGroup, SettingsGroup, SettingsRow } from './settings-controls';

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const PALETTES: { value: Settings['diffPalette']; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'colorblind', label: 'Colour-blind' },
];

/** Two diff lines in the colours the page shows now. */
function DiffPreview() {
  return (
    <div aria-hidden className="w-full rounded-md border border-border overflow-hidden font-mono text-[11px] leading-5">
      <div className="flex bg-diff-del-bg">
        <span className="w-6 text-center text-diff-deleted">-</span>
        <span className="text-text-secondary">return a - b;</span>
      </div>
      <div className="flex bg-diff-add-bg">
        <span className="w-6 text-center text-diff-added">+</span>
        <span className="text-text-secondary">return a + b;</span>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const settings = useSettings();

  return (
    <SettingsGroup title="Colours">
      <SettingsRow id="theme" label="Theme" hint="System follows the colour scheme of the OS.">
        <ChoiceGroup label="Theme" value={settings.theme} options={THEMES} onChange={(theme) => void updateSettings({ theme })} />
      </SettingsRow>
      <SettingsRow id="diff-colours" label="Diff colours" hint="Added and deleted lines, stats and status letters. Colour-blind uses blue and orange.">
        <ChoiceGroup
          label="Diff colours"
          value={settings.diffPalette}
          options={PALETTES}
          onChange={(diffPalette) => void updateSettings({ diffPalette })}
        />
      </SettingsRow>
      <DiffPreview />
    </SettingsGroup>
  );
}
