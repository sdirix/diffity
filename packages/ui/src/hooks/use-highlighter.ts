import { useState, useEffect, useCallback } from 'react';
import { createHighlighter, type Highlighter, type BundledLanguage, type GrammarState } from 'shiki';
import type { SyntaxToken } from '../lib/syntax-token';

/** Lines longer than this stay plain. Tokenizing minified code is slow and unreadable anyway. */
const TOKENIZE_MAX_LINE_LENGTH = 1000;

const LANG_MAP: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  mdx: 'mdx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  toml: 'toml',
  ini: 'ini',
  lua: 'lua',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  vue: 'vue',
  svelte: 'svelte',
  php: 'php',
  r: 'r',
  scss: 'scss',
  less: 'less',
  sass: 'sass',
  styl: 'stylus',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  cljs: 'clojure',
  pl: 'perl',
  pm: 'perl',
  zig: 'zig',
  nim: 'nim',
  ml: 'ocaml',
  mli: 'ocaml',
  fs: 'fsharp',
  fsx: 'fsharp',
  groovy: 'groovy',
  gradle: 'groovy',
  tf: 'hcl',
  hcl: 'hcl',
  proto: 'protobuf',
  prisma: 'prisma',
  astro: 'astro',
  m: 'objective-c',
  mm: 'objective-cpp',
  tex: 'latex',
  latex: 'latex',
  diff: 'diff',
  patch: 'diff',
  nginx: 'nginx',
  conf: 'ini',
  cfg: 'ini',
  env: 'dotenv',
  bat: 'bat',
  cmd: 'bat',
  asm: 'asm',
  s: 'asm',
  jsonc: 'jsonc',
  json5: 'json5',
  csv: 'csv',
  tsv: 'csv',
  wasm: 'wasm',
  ejs: 'html',
  hbs: 'handlebars',
  pug: 'pug',
  jade: 'pug',
  rst: 'rst',
  jl: 'julia',
  v: 'v',
  sol: 'solidity',
  luau: 'luau',
  glsl: 'glsl',
  hlsl: 'hlsl',
  wgsl: 'wgsl',
};

const FILENAME_MAP: Record<string, BundledLanguage> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmakelists: 'cmake',
  gemfile: 'ruby',
  rakefile: 'ruby',
  justfile: 'just',
  vagrantfile: 'ruby',
};

export function getLang(filePath: string): BundledLanguage | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';

  const fileNameMatch = FILENAME_MAP[fileName];
  if (fileNameMatch) {
    return fileNameMatch;
  }

  return LANG_MAP[ext] || null;
}

const ALL_LANGS: BundledLanguage[] = [
  ...new Set([
    ...Object.values(LANG_MAP),
    ...Object.values(FILENAME_MAP),
  ]),
];

let highlighterPromise: Promise<Highlighter> | null = null;
let loadedHighlighter: Highlighter | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: ALL_LANGS,
    }).then((instance) => {
      loadedHighlighter = instance;
      return instance;
    });
  }
  return highlighterPromise;
}

export interface HighlightedTokens {
  tokens: { text: string; color?: string }[];
}

/** Tokens of a run of lines, plus the grammar state to carry into the next run of the same file. */
export interface HighlightChunk {
  lines: SyntaxToken[][];
  state: GrammarState | undefined;
}

export type CodeHighlighter = (code: string, state?: GrammarState) => HighlightChunk | null;

export function useHighlighter() {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(() => loadedHighlighter);

  useEffect(() => {
    if (loadedHighlighter) {
      return;
    }
    getHighlighter().then(setHighlighter);
  }, []);

  const highlight = useCallback((code: string, filePath: string, theme: 'light' | 'dark'): HighlightedTokens[] | null => {
    if (!highlighter) {
      return null;
    }

    const lang = getLang(filePath);
    if (!lang) {
      return null;
    }

    const shikiTheme = theme === 'dark' ? 'github-dark' : 'github-light';

    try {
      const result = highlighter.codeToTokens(code, {
        lang,
        theme: shikiTheme,
      });

      return result.tokens.map(line => ({
        tokens: line.map(token => ({
          text: token.content,
          color: token.color,
        })),
      }));
    } catch {
      return null;
    }
  }, [highlighter]);

  const tokenize = useCallback((code: string, filePath: string, theme: 'light' | 'dark', state?: GrammarState): HighlightChunk | null => {
    if (!highlighter) {
      return null;
    }
    const lang = getLang(filePath);
    if (!lang) {
      return null;
    }
    try {
      const result = highlighter.codeToTokens(code, {
        lang,
        theme: theme === 'dark' ? 'github-dark' : 'github-light',
        grammarState: state,
        tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      });
      return {
        lines: result.tokens.map((line) => line.map((token) => ({ text: token.content, color: token.color }))),
        state: result.grammarState,
      };
    } catch {
      return null;
    }
  }, [highlighter]);

  return { highlight, tokenize, ready: highlighter !== null };
}
