import { describe, expect, it } from 'vitest';
import { pushRecent, rankItems, RECENT_GROUP, type RankItem } from '../src/lib/palette';

const ITEMS: RankItem[] = [
  { id: 'theme', group: 'View', title: 'Switch to dark theme', keywords: 'appearance' },
  { id: 'find', group: 'Actions', title: 'Find in diff' },
  { id: 'split', group: 'View', title: 'Split view' },
  { id: 'ref:work', group: 'Go to', title: 'Uncommitted changes' },
  { id: 'commit:abc', group: 'Commits', title: 'Fix the find bar', keywords: 'abc1234' },
];

const ORDER = ['Actions', 'View', 'Go to', 'Comments', 'Commits'];

function shape(groups: ReturnType<typeof rankItems>) {
  return groups.map((group) => [group.group, group.rows.map((row) => row.item.id)]);
}

describe('rankItems without a query', () => {
  it('orders the groups and keeps the order within each', () => {
    expect(shape(rankItems(ITEMS, '', { recent: [], groupOrder: ORDER }))).toEqual([
      ['Actions', ['find']],
      ['View', ['theme', 'split']],
      ['Go to', ['ref:work']],
      ['Commits', ['commit:abc']],
    ]);
  });

  it('puts recent rows first, most recent first', () => {
    expect(shape(rankItems(ITEMS, '', { recent: ['split', 'gone', 'commit:abc'], groupOrder: ORDER }))).toEqual([
      [RECENT_GROUP, ['split', 'commit:abc']],
      ['Actions', ['find']],
      ['View', ['theme']],
      ['Go to', ['ref:work']],
    ]);
  });

  it('places unknown groups last', () => {
    const items = [{ id: 'x', group: 'Other', title: 'X' }, ...ITEMS];
    expect(shape(rankItems(items, '', { recent: [], groupOrder: ORDER })).at(-1)).toEqual(['Other', ['x']]);
  });

  it('cuts the rows at the limit', () => {
    const groups = rankItems(ITEMS, '', { recent: [], groupOrder: ORDER, limit: 2 });
    expect(shape(groups)).toEqual([['Actions', ['find']], ['View', ['theme']]]);
  });
});

describe('rankItems with a query', () => {
  it('keeps only matching rows, best first, and orders groups by their best row', () => {
    expect(shape(rankItems(ITEMS, 'find', { recent: [], groupOrder: ORDER }))).toEqual([
      ['Actions', ['find']],
      ['Commits', ['commit:abc']],
    ]);
  });

  it('returns the matched title positions', () => {
    const [group] = rankItems(ITEMS, 'split', { recent: [], groupOrder: ORDER });
    expect(group.rows[0].positions).toEqual([0, 1, 2, 3, 4]);
  });

  it('matches keywords without highlighting them', () => {
    const groups = rankItems(ITEMS, 'appearance', { recent: [], groupOrder: ORDER });
    expect(shape(groups)).toEqual([['View', ['theme']]]);
    expect(groups[0].rows[0].positions).toEqual([]);
  });

  it('ranks a title match above a keyword match', () => {
    const items: RankItem[] = [
      { id: 'a', group: 'Actions', title: 'Reload diff', keywords: 'refresh' },
      { id: 'b', group: 'Actions', title: 'Refresh comments' },
    ];
    expect(shape(rankItems(items, 'refresh', { recent: [], groupOrder: ORDER }))).toEqual([['Actions', ['b', 'a']]]);
  });

  it('lets a recent row win a tie', () => {
    const items: RankItem[] = [
      { id: 'a', group: 'Actions', title: 'Open file' },
      { id: 'b', group: 'Actions', title: 'Open file' },
    ];
    expect(shape(rankItems(items, 'open', { recent: ['b'], groupOrder: ORDER }))).toEqual([['Actions', ['b', 'a']]]);
  });

  it('keeps the group order with fixedGroups', () => {
    const files: RankItem[] = [
      { id: 'file:src/finder.ts', group: 'Changed files', title: 'src/finder.ts' },
      { id: 'file:lib/find.ts', group: 'All files', title: 'lib/find.ts' },
    ];
    const groups = rankItems(files, 'find', { recent: [], groupOrder: ['Changed files', 'All files'], fixedGroups: true });
    expect(shape(groups)).toEqual([
      ['Changed files', ['file:src/finder.ts']],
      ['All files', ['file:lib/find.ts']],
    ]);
  });

  it('does not show a recent group', () => {
    const groups = rankItems(ITEMS, 'split', { recent: ['split'], groupOrder: ORDER });
    expect(groups.map((group) => group.group)).toEqual(['View']);
  });
});

describe('pushRecent', () => {
  it('moves the value to the front without duplicates', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c', 5)).toEqual(['c', 'a', 'b']);
    expect(pushRecent([], 'a', 5)).toEqual(['a']);
  });

  it('drops the oldest beyond the limit', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});
