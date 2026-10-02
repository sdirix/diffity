const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Label of the platform mod key, Cmd on Mac and Ctrl elsewhere. */
export const MOD_KEY = IS_MAC ? 'Cmd' : 'Ctrl';

export function isModPressed(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}
