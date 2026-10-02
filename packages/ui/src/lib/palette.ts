import { fuzzyMatch } from './fuzzy';

export interface RankItem {
  id: string;
  group: string;
  title: string;
  /** More text to match the query against, not shown. */
  keywords?: string;
}

export interface Ranked<T> {
  item: T;
  /** Indexes of `item.title` that matched the query. */
  positions: number[];
}

export interface RankedGroup<T> {
  group: string;
  rows: Ranked<T>[];
}

export interface RankOptions {
  /** Ids of recently used rows, most recent first. */
  recent: string[];
  groupOrder: string[];
  /** Keep `groupOrder` while a query is typed, instead of ordering groups by their best match. */
  fixedGroups?: boolean;
  limit?: number;
}

export const RECENT_GROUP = 'Recent';

/** A title match beats a match that needs the keywords, which highlights nothing. */
const KEYWORD_PENALTY = 30;

function matchItem(item: RankItem, query: string): { score: number; positions: number[] } | null {
  const title = fuzzyMatch(query, item.title);
  if (title) {
    return title;
  }
  if (!item.keywords) {
    return null;
  }
  const all = fuzzyMatch(query, `${item.title} ${item.keywords}`);
  if (!all) {
    return null;
  }
  return { score: all.score - KEYWORD_PENALTY, positions: [] };
}

function groupRank(groupOrder: string[], group: string): number {
  if (group === RECENT_GROUP) {
    return -1;
  }
  const index = groupOrder.indexOf(group);
  return index < 0 ? groupOrder.length : index;
}

function collect<T extends RankItem>(rows: { item: T; group: string; positions: number[] }[], limit: number): RankedGroup<T>[] {
  const groups: RankedGroup<T>[] = [];
  const byName = new Map<string, RankedGroup<T>>();
  for (const row of rows.slice(0, limit)) {
    let group = byName.get(row.group);
    if (!group) {
      group = { group: row.group, rows: [] };
      byName.set(row.group, group);
      groups.push(group);
    }
    group.rows.push({ item: row.item, positions: row.positions });
  }
  return groups;
}

/**
 * Filters and orders the rows of the command palette. Without a query, the
 * recent rows come first in their own group, then the other groups in
 * `groupOrder`. With a query, only matching rows are kept, best first, with
 * a small boost for recent ones, and the groups follow their best row unless
 * `fixedGroups` is set.
 */
export function rankItems<T extends RankItem>(items: T[], query: string, options: RankOptions): RankedGroup<T>[] {
  const { recent, groupOrder, fixedGroups = false, limit = Infinity } = options;
  const recentIndex = new Map(recent.map((id, index) => [id, index]));

  if (!query.trim()) {
    const rows = items.map((item, order) => {
      const index = recentIndex.get(item.id);
      return { item, order, group: index === undefined ? item.group : RECENT_GROUP, recent: index ?? 0 };
    });
    rows.sort((a, b) => groupRank(groupOrder, a.group) - groupRank(groupOrder, b.group) || a.recent - b.recent || a.order - b.order);
    return collect(rows.map((row) => ({ ...row, positions: [] })), limit);
  }

  const rows: { item: T; group: string; positions: number[]; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const match = matchItem(item, query);
    if (!match) {
      return;
    }
    const index = recentIndex.get(item.id);
    const boost = index === undefined ? 0 : Math.max(0, 20 - index);
    rows.push({ item, group: item.group, positions: match.positions, score: match.score + boost, order });
  });
  rows.sort((a, b) => b.score - a.score || a.order - b.order);
  if (fixedGroups) {
    rows.sort((a, b) => groupRank(groupOrder, a.group) - groupRank(groupOrder, b.group));
    return collect(rows, limit);
  }
  const best = new Map<string, number>();
  rows.forEach((row, index) => {
    if (!best.has(row.group)) {
      best.set(row.group, index);
    }
  });
  rows.sort((a, b) => best.get(a.group)! - best.get(b.group)!);
  return collect(rows, limit);
}

/** `list` with `value` moved to the front, at most `limit` long. */
export function pushRecent(list: string[], value: string, limit: number): string[] {
  return [value, ...list.filter((item) => item !== value)].slice(0, limit);
}

const RECENT_ACTIONS_KEY = 'diffity-palette-recent';
const RECENT_FILES_KEY = 'diffity-palette-files:';

function readList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function remember(key: string, value: string, limit: number) {
  try {
    localStorage.setItem(key, JSON.stringify(pushRecent(readList(key), value, limit)));
  } catch {
    // Storage unavailable, the palette just does not remember
  }
}

export function recentActions(): string[] {
  return readList(RECENT_ACTIONS_KEY);
}

export function rememberAction(id: string) {
  remember(RECENT_ACTIONS_KEY, id, 12);
}

/** Recent files are kept per repository, as the same port may serve another one later. */
export function recentFiles(repo: string): string[] {
  return readList(RECENT_FILES_KEY + repo);
}

export function rememberFile(repo: string, path: string) {
  remember(RECENT_FILES_KEY + repo, path, 20);
}
