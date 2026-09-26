import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FONTS,
  LIMITS,
  THEMES,
  useSettings,
  type FontId,
  type Settings,
  type SettingsStore,
  type ThemeId,
} from '@/store/settings-store';
import { notePrefs, useNotePrefs } from '@/store/note-prefs';

interface Props {
  settings: SettingsStore;
}

const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'Auto' },
  ...Object.entries(THEMES).map(([id, t]) => ({ id: id as ThemeId, label: t.label })),
  { id: 'custom', label: 'Custom' },
];

/** Gear button plus a drawer with every look-and-feel setting. Changes apply live. */
export function SettingsPanel({ settings }: Props) {
  const [open, setOpen] = useState(false);
  const s = useSettings(settings, (st) => st);
  const panelRef = useRef<HTMLDivElement>(null);
  const update = (patch: Partial<Settings>) => s.update(patch);
  const notesCollapsed = useNotePrefs((n) => n.collapsedByDefault);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || (target as HTMLElement).closest?.('[data-settings-toggle]')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        data-settings-toggle
        onClick={() => setOpen((o) => !o)}
        className="fixed top-3 right-3 z-40 rounded-md p-2 text-muted hover:bg-hover hover:text-ink"
        aria-label="Settings"
        aria-expanded={open}
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Settings"
          data-testid="settings-panel"
          className="fixed top-14 right-3 z-40 max-h-[calc(100vh-4.5rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm text-ink shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Appearance</h2>
            <button type="button" onClick={() => s.reset()} className="text-xs text-muted underline-offset-2 hover:underline">
              Reset
            </button>
          </div>

          <Field label="Theme">
            <div className="grid grid-cols-5 gap-1">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => update({ theme: t.id })}
                  className={
                    'rounded border px-1 py-1 text-xs ' +
                    (s.theme === t.id
                      ? 'border-accent bg-selection text-accent'
                      : 'border-line hover:bg-hover')
                  }
                  aria-pressed={s.theme === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>

          {s.theme === 'custom' && (
            <div className="mb-4 grid grid-cols-4 gap-2">
              <ColorInput label="Background" value={s.deskColor} onChange={(v) => update({ deskColor: v })} />
              <ColorInput label="Page" value={s.pageColor} onChange={(v) => update({ pageColor: v })} />
              <ColorInput label="Text" value={s.textColor} onChange={(v) => update({ textColor: v })} />
              <ColorInput label="Accent" value={s.accentColor} onChange={(v) => update({ accentColor: v })} />
            </div>
          )}

          <Field label="Font">
            <select
              value={s.font}
              onChange={(e) => update({ font: e.target.value as FontId })}
              className="w-full rounded border border-line bg-transparent px-2 py-1"
              aria-label="Font"
            >
              {Object.entries(FONTS).map(([id, f]) => (
                <option key={id} value={id} style={{ fontFamily: f.stack }}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <Slider label="Font size" value={s.fontSize} format={(v) => `${v}px`} limits={LIMITS.fontSize} onChange={(v) => update({ fontSize: v })} />
          <Slider label="Line spacing" value={s.lineHeight} format={(v) => v.toFixed(2)} limits={LIMITS.lineHeight} onChange={(v) => update({ lineHeight: v })} />
          <Field label="Page shape">
            <div className="grid grid-cols-2 gap-1">
              {(['portrait', 'landscape'] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => update({ pageShape: shape })}
                  className={
                    'flex items-center justify-center gap-2 rounded border px-2 py-1.5 text-xs capitalize ' +
                    (s.pageShape === shape ? 'border-accent bg-selection text-accent' : 'border-line hover:bg-hover')
                  }
                  aria-pressed={s.pageShape === shape}
                >
                  <span
                    aria-hidden="true"
                    className={'inline-block rounded-[2px] border border-current ' + (shape === 'portrait' ? 'h-3.5 w-2.5' : 'h-2.5 w-3.5')}
                  />
                  {shape}
                </button>
              ))}
            </div>
          </Field>
          {s.pageShape === 'landscape' ? (
            <Slider
              label="Page width"
              value={s.landscapeWidth}
              format={(v) => `${v}px`}
              limits={LIMITS.landscapeWidth}
              onChange={(v) => update({ landscapeWidth: v })}
            />
          ) : (
            <Slider label="Page width" value={s.pageWidth} format={(v) => `${v}px`} limits={LIMITS.pageWidth} onChange={(v) => update({ pageWidth: v })} />
          )}

          <Toggle label="Book page" hint="Show the text on a sheet of paper" checked={s.bookPage} onChange={(v) => update({ bookPage: v })} />
          <Toggle label="Outline sidebar" hint="Ctrl+\ toggles it" checked={s.sidebarOpen} onChange={(v) => update({ sidebarOpen: v })} />
          <Slider label="Outline levels shown" value={s.outlineDepth} format={(v) => String(v)} limits={LIMITS.outlineDepth} onChange={(v) => update({ outlineDepth: v })} />

          <Toggle
            label="Notes start collapsed"
            hint="Show only a note's first line until you open it"
            checked={notesCollapsed}
            onChange={(v) => notePrefs.getState().setCollapsedByDefault(v)}
          />

          <p className="mt-3 text-xs text-muted">Saved in this browser only.</p>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  format,
  limits,
  onChange,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  limits: { min: number; max: number; step: number };
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-4 block">
      <div className="mb-1 flex justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
        aria-label={label}
      />
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-3 flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-accent" />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-muted">
      <span className="mb-1 block">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full cursor-pointer rounded border border-line" />
    </label>
  );
}
