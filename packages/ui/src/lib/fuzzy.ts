export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number;
  /** Indexes of the matched characters in the text, ascending. */
  positions: number[];
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

const SEPARATORS = ' /\\_-.:@#';

/** Whether `index` starts a word: the text start, after a separator, or a camelCase hump. */
function isWordStart(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text[index - 1];
  if (SEPARATORS.includes(previous)) {
    return true;
  }
  return /[a-z0-9]/.test(previous) && /[A-Z]/.test(text[index]);
}

/** Lower case with one character per character, so indexes stay valid for `text`. */
function fold(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    return lower;
  }
  return text.split('').map((char) => {
    const folded = char.toLowerCase();
    return folded.length === 1 ? folded : char;
  }).join('');
}

function scorePositions(text: string, positions: number[]): number {
  const basenameStart = text.lastIndexOf('/') + 1;
  let score = 0;
  for (let i = 0; i < positions.length; i++) {
    const index = positions[i];
    score += 16;
    if (i > 0) {
      const gap = index - positions[i - 1] - 1;
      score += gap === 0 ? 24 : -Math.min(gap, 12);
    }
    if (isWordStart(text, index)) {
      score += 20;
    }
    if (index >= basenameStart) {
      score += 8;
    }
  }
  if (positions[0] === basenameStart) {
    score += 12;
  }
  return score - text.length * 0.1;
}

/** The tightest subsequence of `needle` in `hay` from `from` on, ending as early as possible. */
function subsequence(hay: string, needle: string, from: number): number[] | null {
  let next = 0;
  let end = -1;
  for (let i = from; i < hay.length; i++) {
    if (hay[i] === needle[next]) {
      next++;
      if (next === needle.length) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    return null;
  }
  const positions: number[] = [];
  next = needle.length - 1;
  for (let i = end; i >= from && next >= 0; i--) {
    if (hay[i] === needle[next]) {
      positions.push(i);
      next--;
    }
  }
  return positions.reverse();
}

/**
 * Matches `query` against `text`, ignoring case. A contiguous occurrence wins
 * over scattered characters. Otherwise the characters of the query, without
 * spaces, must appear in order, preferably within the last path segment.
 * Word starts, runs and short texts score higher. `null` means no match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = fold(query.trim());
  if (!needle) {
    return { score: 0, positions: [] };
  }
  const hay = fold(text);

  let best: FuzzyMatch | null = null;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const positions = Array.from({ length: needle.length }, (_, i) => at + i);
    const score = scorePositions(text, positions);
    if (!best || score > best.score) {
      best = { score, positions };
    }
  }
  if (best) {
    return best;
  }

  const chars = needle.replace(/\s+/g, '');
  const basenameStart = hay.lastIndexOf('/') + 1;
  const positions = (basenameStart > 0 ? subsequence(hay, chars, basenameStart) : null) ?? subsequence(hay, chars, 0);
  if (!positions) {
    return null;
  }
  return { score: scorePositions(text, positions), positions };
}

/** Splits `text` into runs of matched and unmatched characters for rendering. */
export function highlightSegments(text: string, positions: number[]): HighlightSegment[] {
  const matched = new Set(positions);
  const segments: HighlightSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = matched.has(i);
    const last = segments[segments.length - 1];
    if (last && last.match === match) {
      last.text += text[i];
    } else {
      segments.push({ text: text[i], match });
    }
  }
  return segments;
}
