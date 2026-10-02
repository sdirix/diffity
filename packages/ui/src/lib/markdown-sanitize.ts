import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as MarkdownOptions } from 'react-markdown';

const CLOBBER_PREFIX = defaultSchema.clobberPrefix ?? 'user-content-';

interface HastNode {
  type: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function prefixFragments(node: HastNode) {
  const href = node.properties?.href;
  if (node.type === 'element' && typeof href === 'string' && href.length > 1 && href.startsWith('#')) {
    node.properties!.href = `#${CLOBBER_PREFIX}${href.slice(1)}`;
  }
  node.children?.forEach(prefixFragments);
}

/** Points in-page links at the ids the sanitizer prefixed, like GitHub does. */
function rehypePrefixFragments() {
  return (tree: HastNode) => prefixFragments(tree);
}

/** Renders the HTML in Markdown and keeps what GitHub keeps of it, which is the default schema. */
export const RAW_HTML_REHYPE_PLUGINS: MarkdownOptions['rehypePlugins'] = [rehypeRaw, [rehypeSanitize, defaultSchema], rehypePrefixFragments];

/** The sanitizer prefixes the ids, so footnotes come without a prefix of their own. */
export const RAW_HTML_REMARK_REHYPE_OPTIONS: MarkdownOptions['remarkRehypeOptions'] = { clobberPrefix: '' };
