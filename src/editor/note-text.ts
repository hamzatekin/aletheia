import Image from '@tiptap/extension-image';
import Text from '@tiptap/extension-text';
import type { Node as PMNode } from '@tiptap/pm/model';

interface TextState {
  esc(text: string, startOfLine?: boolean): string;
  text(text: string, escape?: boolean): void;
}

/** Text that would read as a link or reference once its brackets were bare ("[a](b)", "[a][b]", "[a]: b"). */
const LINK_LIKE = /\]\s*[([]|^\s*\[[^\]]*\]:/;

/**
 * Text written back as typed: brackets ("[1]", "[x]") are escaped only where
 * they would otherwise make a link, a lone "*" not at all, and "<" and ">"
 * stay themselves. (The default escapes every bracket and writes "<" as "&lt;".)
 */
export const NoteText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TextState, node: PMNode) {
          const esc = state.esc;
          const text = node.text ?? '';
          const bare = (str: string) => (LINK_LIKE.test(text) ? str : str.replace(/\\([[\]])/g, '$1'));
          // A "*" with spaces on both sides mid-line ("5 * 3") can't start emphasis or a list.
          state.esc = (str, startOfLine) => bare(esc.call(state, str, startOfLine)).replace(/(\S\s+)\\\*(?=\s|$)/g, '$1*');
          state.text(text);
          state.esc = esc;
        },
        parse: {},
      },
    };
  },
});

/** Images in notes, as Markdown writes them (inline, "![alt](src)"). */
export const NoteImage = Image.configure({ inline: true, allowBase64: true, HTMLAttributes: { referrerpolicy: 'no-referrer', loading: 'lazy' } });
