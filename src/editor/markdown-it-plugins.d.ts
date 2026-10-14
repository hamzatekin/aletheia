// These plugins ship no types (@types/markdown-it-footnote targets markdown-it 14's).
declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const footnotes: PluginSimple;
  export default footnotes;
}

declare module 'markdown-it-emoji' {
  import type { PluginWithOptions } from 'markdown-it';
  export const full: PluginWithOptions<{ shortcuts?: Record<string, string | string[]> }>;
}
