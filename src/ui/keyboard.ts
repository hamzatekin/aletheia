/**
 * Phones open the on-screen keyboard only for a field focused during a tap.
 * The + button's note editor comes up a moment later, on a new page, so the
 * tap focuses this hidden field at once (the keyboard opens) and the editor
 * takes the focus from it when it mounts, which keeps the keyboard up.
 */
let holder: HTMLTextAreaElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Open the phone keyboard now, for an editor that will take focus within `ms`. Call it inside the tap's handler. */
export function holdKeyboard(ms = 2000): void {
  if (!holder) {
    const el = document.createElement('textarea');
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.dataset.testid = 'keyboard-holder';
    // Invisible but focusable (display: none or visibility: hidden can't take focus); 16px so iOS doesn't zoom.
    Object.assign(el.style, { position: 'fixed', left: '0', bottom: '0', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0', fontSize: '16px', pointerEvents: 'none' });
    el.addEventListener('blur', () => el.remove());
    holder = el;
  }
  const el = holder;
  el.value = '';
  document.body.append(el);
  el.focus({ preventScroll: true });
  // If no editor turns up, don't leave the keyboard open on nothing.
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.activeElement === el) el.blur();
  }, ms);
}
