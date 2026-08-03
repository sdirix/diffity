import type { DiffLine as DiffLineType } from '@diffity/parser';
import type { CodeHighlighter } from '../../hooks/use-highlighter';
import type { SyntaxToken } from '../../lib/syntax-token';
import type { ViewMode } from '../../lib/diff-utils';
import type { LineRenderProps } from '../comments/types';
import { renderLineWithComments } from './hunk-block';
import { renderSplitRows } from './hunk-block-split';

function tokensRead(tokens: SyntaxToken[], content: string): boolean {
  let text = '';
  for (const token of tokens) {
    text += token.text;
  }
  return text === content;
}

/** Tokens for expanded context rows: the whole file's when they read the same, else each line on its own. */
export function buildExpansionSyntaxMap(
  lines: DiffLineType[],
  fileSyntax: Map<string, SyntaxToken[]> | undefined,
  highlightCode?: CodeHighlighter,
): Map<string, SyntaxToken[]> {
  const map = new Map<string, SyntaxToken[]>();
  for (const line of lines) {
    if (!line.content) {
      continue;
    }
    const key = `${line.type}-${line.type === 'delete' ? line.oldLineNumber : line.newLineNumber}`;
    const known = fileSyntax?.get(key);
    if (known && tokensRead(known, line.content)) {
      map.set(key, known);
      continue;
    }
    const tokens = highlightCode?.(line.content)?.lines[0];
    if (tokens) {
      map.set(key, tokens);
    }
  }
  return map;
}

export function renderExpansionRows(
  lines: DiffLineType[],
  viewMode: ViewMode,
  keyPrefix: string,
  syntaxMap: Map<string, SyntaxToken[]> | undefined,
  props: LineRenderProps,
): React.ReactNode[] {
  if (viewMode === 'split') {
    return renderSplitRows(lines, true, syntaxMap, keyPrefix, props);
  }

  const result: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(...renderLineWithComments(lines[i], i, true, syntaxMap, props));
  }
  return result;
}
