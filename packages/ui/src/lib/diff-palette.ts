import { getSettings, subscribeSettings, updateSettings, useSettings, type Settings } from './preferences';

/** Colours of added and deleted lines, stats and status badges. */
export type DiffPalette = Settings['diffPalette'];

/** `data-diff-palette` on the root swaps the diff colour tokens in app.css. */
function applyDiffPalette(palette: DiffPalette) {
  if (palette === 'default') {
    document.documentElement.removeAttribute('data-diff-palette');
  } else {
    document.documentElement.setAttribute('data-diff-palette', palette);
  }
}

export function setDiffPalette(next: DiffPalette) {
  void updateSettings({ diffPalette: next });
}

export function useDiffPalette(): DiffPalette {
  return useSettings().diffPalette;
}

if (typeof window !== 'undefined') {
  applyDiffPalette(getSettings().diffPalette);
  subscribeSettings(() => applyDiffPalette(getSettings().diffPalette));
}
