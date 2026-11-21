import { For, onSettled, Show } from 'solid-js';
import type { JSX } from '@solidjs/web';
import {
  FONTS,
  LIMITS,
  THEMES,
  type FontId,
  type Settings,
  type SettingsStore,
  type ThemeId,
} from '@/store/settings-store';
import { notePrefs, useNotePrefs } from '@/store/note-prefs';
import type { SyncService } from '@/sync/service';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { SidebarIcon } from '@/tree-view/OutlineSidebar';
import { useEscToClose } from '@/ui/hooks';
import { useStoreValue } from '@/ui/store';
import { inSandbox } from '@/app/sandbox';
import { DataSection } from './DataSection';
import { SandboxSection } from './SandboxSection';
import { SyncSection } from './SyncSection';
import { TrashSection } from './TrashSection';
import { useOutline } from '@/tree-view/outline-context';

interface Props {
  settings: SettingsStore;
  ui: UiStore;
  sync?: SyncService | undefined;
}

const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'Auto' },
  ...Object.entries(THEMES).map(([id, t]) => ({ id: id as ThemeId, label: t.label })),
  { id: 'custom', label: 'Custom' },
];

/**
 * Gear button plus a sidebar on the right with every look-and-feel setting.
 * It mirrors the outline sidebar: docked beside the page on wide screens, a
 * drawer over the page on narrow ones. Changes apply live.
 */
export function SettingsPanel(props: Props) {
  const open = useUiStore(props.ui, (st) => st.settingsOpen);
  const setOpen = (o: boolean) => props.ui.setSettingsOpen(o);

  // Opening a sync link shows the join prompt here.
  onSettled(() => {
    const sync = props.sync;
    if (!sync) return;
    const check = () => {
      if (sync.state.getState().pendingJoinKey) props.ui.setSettingsOpen(true);
    };
    check();
    return sync.state.subscribe(check);
  });
  const s = useStoreValue(props.settings);
  let panel: HTMLElement | undefined;
  const update = (patch: Partial<Settings>) => props.settings.getState().update(patch);
  const notesCollapsed = useNotePrefs((n) => n.collapsedByDefault);
  const { actions } = useOutline();

  useEscToClose(open, () => panel, () => props.ui.setSettingsOpen(false));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class={['top-icon fixed top-3 right-3 z-40 rounded-md p-2 hover:bg-hover hover:text-ink', open() ? 'bg-active text-ink' : 'text-muted']}
        aria-label="Settings"
        aria-expanded={open() ? 'true' : 'false'}
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="fixed inset-0 z-50 bg-black/20 lg:hidden" aria-hidden="true" onMouseDown={() => setOpen(false)} />
        <aside
          ref={panel}
          aria-label="Settings"
          data-testid="settings-panel"
          class="settings-sidebar fixed inset-y-0 right-0 z-50 flex flex-col text-sm text-ink shadow-xl lg:z-30 lg:shadow-none"
        >
          <div class="flex items-center justify-between px-4 pt-4 pb-2">
            <span class="text-xs font-semibold tracking-wider text-muted uppercase">Settings</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              class="rounded p-1 text-muted hover:bg-hover hover:text-ink"
              aria-label="Hide settings"
              title="Hide settings (Esc)"
            >
              <SidebarIcon side="right" />
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6">
            <Show when={props.sync}>
              <SyncSection sync={props.sync!} />
            </Show>
            <Show when={inSandbox}>
              <SandboxSection class="mb-4 border-b border-line pb-4" />
            </Show>
            <div class="mb-3 flex items-center justify-between">
              <h2 class="font-semibold">Appearance</h2>
              <button type="button" onClick={() => props.settings.getState().reset()} class="text-xs text-muted underline-offset-2 hover:underline">
                Reset
              </button>
            </div>

            <Field label="Theme">
              <div class="grid grid-cols-5 gap-1">
                <For each={THEME_OPTIONS}>
                  {(t) => (
                    <button
                      type="button"
                      onClick={() => update({ theme: t.id })}
                      class={['rounded border px-1 py-1 text-xs', s().theme === t.id ? 'border-accent bg-selection text-accent' : 'border-line hover:bg-hover']}
                      aria-pressed={s().theme === t.id ? 'true' : 'false'}
                    >
                      {t.label}
                    </button>
                  )}
                </For>
              </div>
            </Field>

            <Show when={s().theme === 'custom'}>
              <div class="mb-4 grid grid-cols-4 gap-2">
                <ColorInput label="Background" value={s().deskColor} onChange={(v) => update({ deskColor: v })} />
                <ColorInput label="Page" value={s().pageColor} onChange={(v) => update({ pageColor: v })} />
                <ColorInput label="Text" value={s().textColor} onChange={(v) => update({ textColor: v })} />
                <ColorInput label="Accent" value={s().accentColor} onChange={(v) => update({ accentColor: v })} />
              </div>
            </Show>

            <Field label="Font">
              <select
                value={s().font}
                onChange={(e) => update({ font: e.currentTarget.value as FontId })}
                class="w-full rounded border border-line bg-transparent px-2 py-1"
                aria-label="Font"
              >
                <For each={Object.entries(FONTS)}>
                  {([id, f]) => (
                    <option value={id} style={{ 'font-family': f.stack }}>
                      {f.label}
                    </option>
                  )}
                </For>
              </select>
            </Field>

            <Slider label="Font size" value={s().fontSize} format={(v) => `${v}px`} limits={LIMITS.fontSize} onChange={(v) => update({ fontSize: v })} />
            <Slider label="Line spacing" value={s().lineHeight} format={(v) => v.toFixed(2)} limits={LIMITS.lineHeight} onChange={(v) => update({ lineHeight: v })} />
            {/* Narrow screens always use the full width, so the page controls change nothing there. */}
            <div class="max-sm:hidden">
              <Field label="Page shape">
                <div class="grid grid-cols-2 gap-1">
                  <For each={['portrait', 'landscape'] as const}>
                    {(shape) => (
                      <button
                        type="button"
                        onClick={() => update({ pageShape: shape })}
                        class={[
                          'flex items-center justify-center gap-2 rounded border px-2 py-1.5 text-xs capitalize',
                          s().pageShape === shape ? 'border-accent bg-selection text-accent' : 'border-line hover:bg-hover',
                        ]}
                        aria-pressed={s().pageShape === shape ? 'true' : 'false'}
                      >
                        <span
                          aria-hidden="true"
                          class={['inline-block rounded-[2px] border border-current', shape === 'portrait' ? 'h-3.5 w-2.5' : 'h-2.5 w-3.5']}
                        />
                        {shape}
                      </button>
                    )}
                  </For>
                </div>
              </Field>
              <Show
                when={s().pageShape === 'landscape'}
                fallback={<Slider label="Page width" value={s().pageWidth} format={(v) => `${v}px`} limits={LIMITS.pageWidth} onChange={(v) => update({ pageWidth: v })} />}
              >
                <Slider
                  label="Page width"
                  value={s().landscapeWidth}
                  format={(v) => `${v}px`}
                  limits={LIMITS.landscapeWidth}
                  onChange={(v) => update({ landscapeWidth: v })}
                />
              </Show>

              <Toggle label="Book page" hint="Show the text on a sheet of paper" checked={s().bookPage} onChange={(v) => update({ bookPage: v })} />
            </div>
            <Toggle label="Outline sidebar" hint="Ctrl+\ toggles it" checked={s().sidebarOpen} onChange={(v) => update({ sidebarOpen: v })} />
            <Slider label="Outline levels shown" value={s().outlineDepth} format={(v) => String(v)} limits={LIMITS.outlineDepth} onChange={(v) => update({ outlineDepth: v })} />

            <Toggle
              label="Notes start collapsed"
              hint="Hide notes in the list until you're on their item"
              checked={notesCollapsed()}
              onChange={(v) => notePrefs.getState().setCollapsedByDefault(v)}
            />
            <Toggle label="Inbox dates" hint="Show when each Inbox item was added" checked={s().inboxDates} onChange={(v) => update({ inboxDates: v })} />
            <Toggle label="Show completed" hint="Done items stay, struck through. Ctrl+O toggles it" checked={s().showCompleted} onChange={() => actions.toggleShowCompleted()} />

            <p class="mt-3 text-xs text-muted">Appearance is saved in this browser only.</p>
            <DataSection />
            <TrashSection />
            <Show when={!inSandbox}>
              <SandboxSection class="mt-4 border-t border-line pt-4" />
            </Show>
          </div>
        </aside>
      </Show>
    </>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div class="mb-4">
      <div class="mb-1.5 text-xs font-medium text-muted">{props.label}</div>
      {props.children}
    </div>
  );
}

// Sliders and colour pickers write on every `input` event, so the page follows the drag; `onChange` fires only on release.
function Slider(props: {
  label: string;
  value: number;
  format: (v: number) => string;
  limits: { min: number; max: number; step: number };
  onChange: (v: number) => void;
}) {
  return (
    <label class="mb-4 block">
      <div class="mb-1 flex justify-between text-xs font-medium text-muted">
        <span>{props.label}</span>
        <span class="tabular-nums">{props.format(props.value)}</span>
      </div>
      <input
        type="range"
        min={props.limits.min}
        max={props.limits.max}
        step={props.limits.step}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        class="w-full accent-accent"
        aria-label={props.label}
      />
    </label>
  );
}

function Toggle(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="mb-3 flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span class="block">{props.label}</span>
        <span class="block text-xs text-muted">{props.hint}</span>
      </span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} class="size-4 accent-accent" />
    </label>
  );
}

function ColorInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="block text-xs text-muted">
      <span class="mb-1 block">{props.label}</span>
      <input type="color" value={props.value} onInput={(e) => props.onChange(e.currentTarget.value)} class="h-8 w-full cursor-pointer rounded border border-line" />
    </label>
  );
}
