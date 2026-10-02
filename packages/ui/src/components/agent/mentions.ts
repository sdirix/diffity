/** The handles that call the agent into a thread, like the server reads them. */
export const AGENT_HANDLES = ['claude', 'agent'];

export interface MentionQuery {
  /** Where the `@` is. */
  start: number;
  end: number;
  /** The handles that complete what was typed after the `@`. */
  handles: string[];
}

/** The handle being typed before `caret`, `null` when none or when it is complete. */
export function mentionQuery(value: string, caret: number): MentionQuery | null {
  const match = /(^|[\s(])@([\w-]*)$/.exec(value.slice(0, caret));
  if (!match) {
    return null;
  }
  const typed = match[2].toLowerCase();
  const handles = AGENT_HANDLES.filter((handle) => handle.startsWith(typed) && handle !== typed);
  if (handles.length === 0 || AGENT_HANDLES.includes(typed)) {
    return null;
  }
  return { start: caret - typed.length - 1, end: caret, handles };
}
