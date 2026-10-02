import { describe, it, expect } from 'vitest';
import { createDiffIgnore } from '../src/diffignore.js';

describe('createDiffIgnore', () => {
  it('ignores nothing without rules', () => {
    for (const rules of [createDiffIgnore([]), createDiffIgnore(['']), createDiffIgnore(['# generated\n\n'])]) {
      expect(rules.hash).toBe('');
      expect(rules.isIgnored('dist/a.js')).toBe(false);
    }
  });

  it('matches globs, folders and anchored paths like gitignore', () => {
    const rules = createDiffIgnore(['# generated\n*.min.js\ndist/\n/schema.gen.ts\n']);
    expect(rules.isIgnored('app.min.js')).toBe(true);
    expect(rules.isIgnored('web/vendor/app.min.js')).toBe(true);
    expect(rules.isIgnored('dist/bundle.js')).toBe(true);
    expect(rules.isIgnored('packages/ui/dist/index.js')).toBe(true);
    expect(rules.isIgnored('dist', true)).toBe(true);
    expect(rules.isIgnored('dist')).toBe(false);
    expect(rules.isIgnored('schema.gen.ts')).toBe(true);
    expect(rules.isIgnored('src/schema.gen.ts')).toBe(false);
    expect(rules.isIgnored('src/app.js')).toBe(false);
  });

  it('is case sensitive', () => {
    const rules = createDiffIgnore(['*.snap\n']);
    expect(rules.isIgnored('a.snap')).toBe(true);
    expect(rules.isIgnored('a.SNAP')).toBe(false);
  });

  it('shows a negated file, also under a hidden folder', () => {
    const rules = createDiffIgnore(['dist/\n*.generated.ts\n!dist/keep.js\n!keep.generated.ts\n']);
    expect(rules.isIgnored('dist/a.js')).toBe(true);
    expect(rules.isIgnored('dist/keep.js')).toBe(false);
    expect(rules.isIgnored('dist/sub/keep.js')).toBe(true);
    expect(rules.isIgnored('src/api.generated.ts')).toBe(true);
    expect(rules.isIgnored('keep.generated.ts')).toBe(false);
  });

  it('lets the last matching rule win', () => {
    const rules = createDiffIgnore(['generated/**\n!generated/*.ts\ngenerated/secret.ts\n']);
    expect(rules.isIgnored('generated/a.json')).toBe(true);
    expect(rules.isIgnored('generated/a.ts')).toBe(false);
    expect(rules.isIgnored('generated/secret.ts')).toBe(true);
    expect(rules.isIgnored('generated', true)).toBe(false);
  });

  it('lets a later source override an earlier one', () => {
    const rules = createDiffIgnore(['*.lock\n', '!Cargo.lock\n']);
    expect(rules.isIgnored('yarn.lock')).toBe(true);
    expect(rules.isIgnored('Cargo.lock')).toBe(false);
  });

  it('hashes the rules', () => {
    expect(createDiffIgnore(['dist/\n']).hash).toBe(createDiffIgnore(['# x\ndist/\n']).hash);
    expect(createDiffIgnore(['dist/\n']).hash).not.toBe(createDiffIgnore(['build/\n']).hash);
  });

  it('excludes a hidden folder whole unless a negation could show a file in it', () => {
    const rules = createDiffIgnore(['dist/\n*.snap\n']);
    expect(rules.exclusionFor('dist/a/b.js')).toBe('dist');
    expect(rules.exclusionFor('pkg/dist/b.js')).toBe('pkg/dist');
    expect(rules.exclusionFor('tests/__snapshots__/a.snap')).toBe('tests/__snapshots__/a.snap');
    expect(createDiffIgnore(['dist/*\n!dist/keep.js\n']).exclusionFor('dist/a.js')).toBe('dist/a.js');
  });
});
