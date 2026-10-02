import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

/** Renders the HTML in Markdown and strips what GitHub strips, like scripts, event handlers and `javascript:` links. */
export const SANITIZED_HTML_PLUGINS = [rehypeRaw, rehypeSanitize];
