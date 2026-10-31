// On-screen keyboard for the chat bar (iOS Safari / 主畫面 standalone).
//
// What iOS does: when a focused input would end up under the keyboard, WebKit scrolls the document AND pans the visual
// viewport to reveal it (seen on an iPhone: window.scrollY 414 = visualViewport.offsetTop 414 = 912 − 498, the
// whole app slid up by the keyboard height). `focus({ preventScroll })` does not stop it and `scrollTo(0, 0)` only
// fights it (flicker). So iOS must never get a reason to scroll:
//   1. lift — on focus the real <input> is moved far above the screen (transform) until the keyboard is up. iOS wants
//      to reveal an element above the top, the page is already at 0, nothing moves. A ghost in the bar shows the text
//      meanwhile. IME (注音) composition still goes to the real input — it is the same element, only displaced.
//   2. dock — once visualViewport has shrunk, the chat bar is put right on the keyboard (`--kb-bar` = root height −
//      visible height) and the input is dropped back into it: it is visible, so typing never scrolls either.
//   3. lock — while focused, html / body get `overflow: hidden` (class `kb-lock`; the 844-px paint clip that rule
//      causes in standalone is hidden under the keyboard then) and viewport.ts stops snapping scroll back to 0.
//   4. fallback — if iOS pans anyway, the view is moved down by visualViewport.offsetTop (rAF-synced), so the figure
//      and the chat bar stay put on screen.
// The view never resizes (the root keeps its size); while the keyboard is up it is only moved by that offset.
// Numbers for the 尺寸資訊 overlay: `kbDebug`.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { kbDebug } from '../viewport';

const nav = navigator as Navigator & { standalone?: boolean };
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** the keyboard counts as open when the visible height is this much shorter than the view */
const OPEN_PX = 120;
/** give up waiting for the keyboard (hardware keyboard, no visualViewport change) and put the input back */
const LIFT_MAX_MS = 900;
/** frames to keep re-measuring after focus / blur (the keyboard animates ~0.3 s; vv events can lag) */
const SETTLE_MS = 800;

/** Pure layout math (unit-tested). `rootH`: the view's height; vv in layout-viewport coordinates. */
export function keyboardLayout(p: { focused: boolean; rootH: number; vvH: number; vvTop: number; scale?: number }) {
  const covered = p.rootH - p.vvH; // keyboard (+ accessory bar) height, as seen from the view
  const open = p.focused && (p.scale ?? 1) <= 1.01 && covered > OPEN_PX;
  const shift = open ? Math.max(0, Math.round(p.vvTop)) : 0; // view moved down by the visual pan → stays put on screen
  // with the view shifted by vvTop its y = screen y; the visible strip is 0 … vvH
  const bar = open ? Math.max(0, Math.round(covered)) : 0;
  return { open, shift, bar };
}

export function useIOSKeyboard(rootRef: RefObject<HTMLElement | null>, inputRef: RefObject<HTMLInputElement | null>) {
  const st = useRef({ lift: false, liftTimer: 0, raf: 0, settleUntil: 0, open: false, shift: 0, bar: 0 });

  const unlift = useCallback(() => {
    const s = st.current;
    clearTimeout(s.liftTimer);
    if (!s.lift) return;
    s.lift = false;
    inputRef.current?.classList.remove('kb-lift');
  }, [inputRef]);

  const apply = useCallback(() => {
    const root = rootRef.current, input = inputRef.current, s = st.current;
    if (!root) return;
    const vv = window.visualViewport;
    const focused = !!input && document.activeElement === input;
    const rootH = root.offsetHeight || window.innerHeight;
    const { open, shift, bar } = keyboardLayout({
      focused, rootH, vvH: vv?.height ?? window.innerHeight, vvTop: vv?.offsetTop ?? 0, scale: vv?.scale,
    });
    if (open !== s.open) root.classList.toggle('kb-open', open);
    if (shift !== s.shift) root.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
    if (bar !== s.bar) root.style.setProperty('--kb-bar', `${bar}px`);
    if (vv) root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    s.open = open; s.shift = shift; s.bar = bar;
    // docked above the keyboard (this frame's styles) → the input can come back next frame, it is visible there
    if (open && s.lift) requestAnimationFrame(() => { if (st.current.open) unlift(); });
    if (!focused) {
      document.documentElement.classList.remove('kb-lock');
      if (!open && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
    }
  }, [rootRef, inputRef, unlift]);

  const schedule = useCallback(() => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(() => {
      apply();
      if (performance.now() < s.settleUntil) schedule();
    });
  }, [apply]);
  const settle = useCallback(() => { st.current.settleUntil = performance.now() + SETTLE_MS; apply(); schedule(); }, [apply, schedule]);

  const onFocus = useCallback(() => {
    const s = st.current, input = inputRef.current;
    if (isIOS && input && !s.open) {
      document.documentElement.classList.add('kb-lock');
      s.lift = true;
      input.classList.add('kb-lift'); // synchronously, before WebKit asks where the focused element is
      clearTimeout(s.liftTimer);
      s.liftTimer = window.setTimeout(unlift, LIFT_MAX_MS);
    }
    settle();
  }, [inputRef, unlift, settle]);
  const onBlur = useCallback(() => {
    unlift();
    document.documentElement.classList.remove('kb-lock');
    settle();
  }, [unlift, settle]);

  useEffect(() => {
    const vv = window.visualViewport;
    const s = st.current;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    kbDebug.get = () => {
      const de = document.documentElement, v = window.visualViewport;
      const r = (n: number | undefined) => (n == null ? '-' : Math.round(n));
      const inp = inputRef.current?.getBoundingClientRect();
      return `ios ${isIOS ? 1 : 0} sa ${nav.standalone ? 1 : 0} lock ${de.classList.contains('kb-lock') ? 1 : 0} lift ${s.lift ? 1 : 0} ` +
        `open ${s.open ? 1 : 0}\n           shift ${s.shift} bar ${s.bar}  vv.top ${r(v?.offsetTop)} vv.h ${r(v?.height)}  ` +
        `input y ${r(inp?.top)}–${r(inp?.bottom)}`;
    };
    return () => {
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(s.raf);
      clearTimeout(s.liftTimer);
      document.documentElement.classList.remove('kb-lock');
      delete kbDebug.get;
    };
  }, [schedule, inputRef]);

  return { onFocus, onBlur };
}
