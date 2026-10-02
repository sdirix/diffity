import type { FindMatch } from './find';

const MATCH_HIGHLIGHT = 'diffity-find';
const CURRENT_HIGHLIGHT = 'diffity-find-current';

interface TextSegment {
  node: Text;
  start: number;
}

function supported(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.highlights;
}

function textSegments(element: Element): TextSegment[] {
  const segments: TextSegment[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    segments.push({ node: text, start: offset });
    offset += text.data.length;
  }
  return segments;
}

function rangeFor(segments: TextSegment[], start: number, end: number): Range | null {
  const locate = (offset: number, preferNext: boolean) => {
    for (const segment of segments) {
      const segmentEnd = segment.start + segment.node.data.length;
      const inside = preferNext ? offset < segmentEnd : offset <= segmentEnd;
      if (offset >= segment.start && inside) {
        return { node: segment.node, offset: offset - segment.start };
      }
    }
    return null;
  };
  const from = locate(start, true);
  const to = locate(end, false);
  if (!from || !to) {
    return null;
  }
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

export function matchId(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

/** Matches grouped by `matchId` for painting. */
export function groupMatches(matches: FindMatch[]): Map<string, FindMatch[]> {
  const byLine = new Map<string, FindMatch[]>();
  for (const match of matches) {
    const id = matchId(match.scope, match.key);
    const list = byLine.get(id);
    if (list) {
      list.push(match);
    } else {
      byLine.set(id, [match]);
    }
  }
  return byLine;
}

/** Highlights the matches in the lines mounted right now. Virtualized files are painted again when they mount. */
export function paintMatches(root: ParentNode, byLine: Map<string, FindMatch[]>, current: FindMatch | null) {
  if (!supported()) {
    return;
  }
  const all: Range[] = [];
  const emphasized: Range[] = [];
  for (const scopeElement of root.querySelectorAll('[data-find-scope]')) {
    const scope = scopeElement.getAttribute('data-find-scope') ?? '';
    for (const lineElement of scopeElement.querySelectorAll('[data-find-line]')) {
      const matches = byLine.get(matchId(scope, lineElement.getAttribute('data-find-line') ?? ''));
      if (!matches) {
        continue;
      }
      const segments = textSegments(lineElement);
      for (const match of matches) {
        const range = rangeFor(segments, match.start, match.end);
        if (range) {
          (match === current ? emphasized : all).push(range);
        }
      }
    }
  }
  const currentHighlight = new Highlight(...emphasized);
  currentHighlight.priority = 1;
  CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...all));
  CSS.highlights.set(CURRENT_HIGHLIGHT, currentHighlight);
}

export function clearMatches() {
  if (!supported()) {
    return;
  }
  CSS.highlights.delete(MATCH_HIGHLIGHT);
  CSS.highlights.delete(CURRENT_HIGHLIGHT);
}
