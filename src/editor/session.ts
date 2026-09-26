import { Editor, Node } from '@tiptap/core';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import type { Engine } from '@/commands';
import type { Caret } from '@/store/ui-store';
import { markdownOptions, plainText } from './markdown';
import { OutlinerKeymap, type OutlineKey, type OutlinerKeymapStorage } from './outliner-keymap';

/** Content is one paragraph of inline Markdown; no block structure. */
const SingleLineDocument = Node.create({ name: 'doc', topNode: true, content: 'paragraph' });

interface MarkdownInternals extends MarkdownStorage {
  serializer: { serialize(content: PMNode | Fragment): string };
}

interface SessionStorage {
  outlinerKeymap: OutlinerKeymapStorage;
  markdown: MarkdownInternals;
}

const SAVE_DELAY_MS = 400;

/**
 * The one Tiptap instance. It is mounted into whichever row is focused and
 * moved on focus change. Content edits are saved through the engine after a
 * short idle delay, and always before any structural command (`flush`).
 */
export class EditorSession {
  readonly editor: Editor;
  /** Node whose content the editor currently holds. */
  nodeId: string | null = null;
  /** Markdown last synchronised with the store (loaded or saved). */
  known = '';
  /**
   * The editor's own serialization of `known`. Parsing normalises things
   * Markdown cannot express (trailing spaces), so a plain round trip must not
   * count as an edit.
   */
  private loaded = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading = false;
  private mounted = false;
  private readonly unsubscribe: () => void;
  /** Multi-line paste goes to the outline (one node per line). */
  pasteHandler: ((text: string) => boolean) | null = null;

  constructor(private readonly engine: Engine) {
    // Undo/redo (or any command) may change the loaded node's content
    // behind the editor's back; reload it so the view matches the store.
    this.unsubscribe = engine.onOperation((op) => {
      if (this.nodeId === null || !this.mounted) return;
      const change = op.changes.find((c) => c.id === this.nodeId);
      if (!change) return;
      const content = change.after?.content;
      if (content !== undefined && content !== this.known) this.load(this.nodeId, content);
    });
    this.editor = new Editor({
      element: null,
      injectCSS: false,
      extensions: [
        SingleLineDocument,
        StarterKit.configure({
          document: false,
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          hardBreak: false,
          undoRedo: false,
          dropcursor: false,
          gapcursor: false,
          trailingNode: false,
          underline: false,
          link: { openOnClick: false, autolink: false, linkOnPaste: true, markdownLinks: true },
        }),
        Markdown.configure({ ...markdownOptions, transformPastedText: false, transformCopiedText: true }),
        OutlinerKeymap,
      ],
      editorProps: {
        attributes: { class: 'node-content outline-none', spellcheck: 'true' },
        handlePaste: (_view, event) => {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text.includes('\n') && this.pasteHandler) return this.pasteHandler(text);
          return false;
        },
      },
      onUpdate: () => {
        if (this.loading) return;
        this.schedule();
      },
    });
  }

  private get ext(): SessionStorage {
    return this.editor.storage as unknown as SessionStorage;
  }

  get keymap(): OutlinerKeymapStorage {
    return this.ext.outlinerKeymap;
  }

  setKeyHandler(handler: ((key: OutlineKey) => boolean) | null): void {
    this.keymap.handler = handler;
  }

  /** Called after every editor transaction (typing, selection). Returns unsubscribe. */
  onTransaction(listener: () => void): () => void {
    this.editor.on('transaction', listener);
    return () => {
      this.editor.off('transaction', listener);
    };
  }

  /** Delete text between two document positions (used to remove "/query"). */
  deleteRange(from: number, to: number): void {
    this.editor.commands.deleteRange({ from, to });
  }

  caretPos(): number {
    return this.editor.state.selection.from;
  }

  /** Text between a document position and the caret. */
  textFrom(from: number): string | null {
    const { doc, selection } = this.editor.state;
    if (!selection.empty || selection.from < from || from < 0 || from > doc.content.size) return null;
    return doc.textBetween(from, selection.from, '\n');
  }

  mount(el: HTMLElement): void {
    this.editor.mount(el);
    this.mounted = true;
  }

  unmount(): void {
    this.mounted = false;
    this.editor.unmount();
  }

  /** Load a node's Markdown into the editor (does not save the previous node; call `flush` first). */
  load(id: string, content: string): void {
    this.cancel();
    this.loading = true;
    try {
      this.editor.commands.setContent(content, { emitUpdate: false });
    } finally {
      this.loading = false;
    }
    this.nodeId = id;
    this.known = content;
    this.loaded = this.markdown();
  }

  markdown(): string {
    const md = this.ext.markdown.getMarkdown();
    return md.replace(/\n+$/, '');
  }

  /** Markdown of the text before and after the caret (selection is dropped). */
  split(): { left: string; right: string } {
    const { doc, selection } = this.editor.state;
    const serializer = this.ext.markdown.serializer;
    const left = serializer.serialize(doc.cut(0, selection.from)).replace(/\n+$/, '');
    const right = serializer.serialize(doc.cut(selection.to)).replace(/\n+$/, '');
    return { left, right };
  }

  /** Save now if the editor differs from the store. */
  flush(): void {
    this.cancel();
    if (this.nodeId === null) return;
    const md = this.markdown();
    if (md === this.loaded) return;
    this.known = md;
    this.loaded = md;
    this.engine.execute({ type: 'updateContent', id: this.nodeId, content: md });
  }

  /** Forget unsaved edits (used when a split replaces the content anyway). */
  discard(): void {
    this.cancel();
    this.known = this.markdown();
    this.loaded = this.known;
  }

  isEmpty(): boolean {
    return this.editor.state.doc.textContent.length === 0;
  }

  /** Viewport x of the caret, for keeping the column when moving up/down. */
  caretX(): number {
    return this.editor.view.coordsAtPos(this.editor.state.selection.head).left;
  }

  /** Place the caret and focus the editor. The view must be mounted. */
  placeCaret(caret: Caret): void {
    const { editor } = this;
    const size = editor.state.doc.content.size;
    const end = Math.max(1, size - 1);
    let pos: number;
    switch (caret.kind) {
      case 'start':
        pos = 1;
        break;
      case 'end':
        pos = end;
        break;
      case 'offset':
        pos = Math.min(end, 1 + plainText(this.known.slice(0, caret.offset)).length);
        break;
      case 'line':
      case 'point': {
        const dom = editor.view.dom;
        dom.scrollIntoView({ block: 'nearest' });
        const rect = dom.getBoundingClientRect();
        const x = Math.min(Math.max(caret.x, rect.left + 1), rect.right - 1);
        const y =
          caret.kind === 'point'
            ? Math.min(Math.max(caret.y, rect.top + 1), rect.bottom - 1)
            : caret.line === 'first'
              ? rect.top + 2
              : rect.bottom - 2;
        pos = editor.view.posAtCoords({ left: x, top: y })?.pos ?? end;
        break;
      }
    }
    // Focus synchronously: Tiptap's own focus command defers to the next
    // animation frame, which would drop a keystroke typed right after Enter.
    editor.view.focus();
    editor.commands.setTextSelection(pos);
    if (caret.kind !== 'line' && caret.kind !== 'point') editor.commands.scrollIntoView();
  }

  destroy(): void {
    this.cancel();
    this.unsubscribe();
    this.editor.destroy();
  }

  private schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DELAY_MS);
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
