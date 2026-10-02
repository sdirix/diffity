import { useEffect, useState } from 'react';
import type { DiffHunk } from '@diffity/parser';
import type { CodeHighlighter } from './use-highlighter';
import type { SyntaxToken } from '../lib/syntax-token';
import { buildSyntaxMap, planSyntaxSources, tokenizeSources, type FileVersionLines, type SideTokens } from '../lib/syntax-lines';

/** Main thread budget per highlighting step. The rest waits for the next task so scrolling stays smooth. */
const HIGHLIGHT_BUDGET_MS = 8;

/**
 * Tokens for the lines of `hunks`, highlighted from the whole files in
 * `versions` where they match, else from the hunks. Keeps the last result
 * while `enabled` is off.
 */
export function useSyntaxMap(
  highlightCode: CodeHighlighter | undefined,
  enabled: boolean,
  hunks: DiffHunk[],
  versions: FileVersionLines | null,
  maxFileLines: number,
): Map<string, SyntaxToken[]> | undefined {
  const [syntaxMap, setSyntaxMap] = useState<Map<string, SyntaxToken[]> | undefined>(undefined);

  useEffect(() => {
    if (!highlightCode || !enabled) {
      return;
    }

    const plan = planSyntaxSources(hunks, versions, maxFileLines);
    const tokens: SideTokens = { old: new Map(), new: new Map() };
    const work = tokenizeSources(plan.sources, highlightCode, tokens);
    let cancelled = false;
    let timer = 0;

    const step = () => {
      if (cancelled) {
        return;
      }
      const deadline = performance.now() + HIGHLIGHT_BUDGET_MS;
      while (performance.now() < deadline) {
        if (work.next().done) {
          setSyntaxMap(buildSyntaxMap(hunks, tokens, plan.full));
          return;
        }
      }
      timer = window.setTimeout(step, 0);
    };

    timer = window.setTimeout(step, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hunks, highlightCode, enabled, versions, maxFileLines]);

  return syntaxMap;
}
