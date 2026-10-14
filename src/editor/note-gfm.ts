import { Extension } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Text from '@tiptap/extension-text';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { common, createLowlight } from 'lowlight';
import { alertMarker } from './gfm';
import { inlineMathSpans, math } from './math';
import type { MarkdownIt } from 'markdown-it';

interface TextState {
  esc(text: string, startOfLine?: boolean): string;
  text(text: string, escape?: boolean): void;
}

/** Text that would read as a link or reference once its brackets were bare ("[a](b)", "[a][b]", "[a]: b"). */
const LINK_LIKE = /\]\s*[([]|^\s*\[(?!\^)[^\]]*\]:/;

/**
 * Text written back as typed: brackets ("[1]", "[!NOTE]", "[^1]") are
 * escaped only where they would otherwise make a link, a lone "*" not at all, and "<" and ">" stay
 * themselves, so tags like <kbd> or <br> keep working. (The default escapes
 * every bracket and writes "<" as "&lt;".) Math is read as the text it is
 * ($$ blocks as ```math code) and $formulas$ are written back unescaped, so
 * TeX's backslashes and underscores survive an edit.
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
          let at = 0;
          for (const [from, to] of inlineMathSpans(text)) {
            if (from > at) state.text(text.slice(at, from));
            state.text(text.slice(from, to), false);
            at = to;
          }
          if (at < text.length || text === '') state.text(text.slice(at));
          state.esc = esc;
        },
        parse: { setup: (md: MarkdownIt) => md.use(math, { render: 'source' }) },
      },
    };
  },
});

/** Images in notes, as Markdown writes them (inline, "![alt](src)"). */
export const NoteImage = Image.configure({ inline: true, allowBase64: true, HTMLAttributes: { referrerpolicy: 'no-referrer', loading: 'lazy' } });

/**
 * Code coloured as in rendered notes: only fences that name a language,
 * never a guess (terminal output and plain fences stay plain, as on GitHub).
 */
const lowlight = createLowlight(common);
export const NoteCodeBlock = CodeBlockLowlight.configure({
  lowlight: { ...lowlight, highlightAuto: () => ({ type: 'root', children: [], data: { language: undefined, relevance: 0 } }) },
});

/**
 * GitHub alerts while editing: the quote takes the alert's colours and its
 * "[!NOTE]" marker is shown as the title, where the rendered note shows "Note".
 */
export const NoteAlerts = Extension.create({
  name: 'noteAlerts',
  addProseMirrorPlugins() {
    const decorate = (doc: PMNode) => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== 'blockquote') return true;
        const first = node.firstChild;
        const marker = first?.type.name === 'paragraph' ? alertMarker(first.textContent) : null;
        if (marker) {
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: `markdown-alert markdown-alert-${marker.kind}` }));
          decorations.push(Decoration.inline(pos + 2, pos + 2 + marker.length, { class: 'markdown-alert-title' }));
        }
        return true;
      });
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin({
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
