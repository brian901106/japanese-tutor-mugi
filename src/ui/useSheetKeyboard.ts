// On-screen keyboard for a bottom sheet's text fields (速查, the 人物 / ⚙️ settings). Same idea as the chat bar's
// (useIOSKeyboard): iOS must never get a reason to scroll the page, or the whole view slides up and back.
//   1. lift — on focus the field is moved far above the screen (class kb-lift) until the keyboard is up, so WebKit has
//      nothing to reveal; html gets kb-lock, so viewport.ts does not snap a scroll back (the slide).
//   2. once visualViewport has shrunk the sheet is placed for the keyboard (class kb-open on the backdrop, which is painted
//      solid from the keyboard's top down, `--kb-top`, so what shows behind the translucent keyboard is black), then the
//      field is dropped back where it is visible, so typing scrolls nothing:
//      · raise (速查, `anchor` given): the sheet keeps its size and is only moved up until its field row clears the keyboard;
//        what is below it (the history) stays under the keyboard.
//      · pad (settings, `body` given): the sheet keeps its size and place, its bottom padding grows by the keyboard's height,
//        so its scrolling body ends above the keyboard (a short sheet grows so some of it shows); the focused field is
//        scrolled into view inside the body.
//   pan — if iOS pans the visual viewport anyway (seen on an iPhone: the top buttons went under the status bar), the app
//      (#root) is moved down by visualViewport.offsetTop, as the chat bar does, so nothing moves on screen; while the keyboard
//      is up a finger drag outside the body does not scroll the page either.
//   3. blur — the field comes back, the sheet goes back, a stray scroll is undone. Moving from one field to another keeps
//      the keyboard placement (the check runs a frame later, after the next field has taken the focus).
import { useCallback, useEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';
import { isIOS } from './useIOSKeyboard';

const OPEN_PX = 120;
const LIFT_MAX_MS = 900;
const SETTLE_MS = 800;

/** a little room between the field and the keyboard */
const GAP_PX = 8;

/** Pure layout math (unit-tested), in layout-viewport coordinates: the keyboard's top and how far the sheet goes up so the
 *  field row (its bottom `anchorBottom`, unraised) clears it; null while the keyboard is not up over the focused field. */
export function sheetLift(p: { focused: boolean; fullH: number; vvH: number; vvTop: number; scale?: number; anchorBottom: number }) {
  const open = p.focused && (p.scale ?? 1) <= 1.01 && p.fullH - p.vvH > OPEN_PX;
  if (!open) return null;
  const kbTop = Math.round(Math.max(0, p.vvTop) + p.vvH);
  return { kbTop, shift: Math.max(0, Math.round(p.anchorBottom - kbTop + GAP_PX)) };
}

/** How far a scrolling body scrolls so the field (its top / bottom, in the body's coordinates as on screen) is in view:
 *  the field's bottom clears the body's bottom, but a field taller than the body shows its top. Unit-tested. */
export function scrollToShow(p: { fieldTop: number; fieldBottom: number; bodyTop: number; bodyBottom: number }): number {
  const room = p.bodyBottom - p.bodyTop - 2 * GAP_PX;
  if (p.fieldBottom - p.fieldTop > room || p.fieldTop < p.bodyTop + GAP_PX) return Math.round(p.fieldTop - p.bodyTop - GAP_PX);
  if (p.fieldBottom > p.bodyBottom - GAP_PX) return Math.round(p.fieldBottom - p.bodyBottom + GAP_PX);
  return 0;
}

/** pad: how much of a short sheet stays above the keyboard (it grows up to this); the room kept for the top bar when it
 *  cannot be measured, and the gap under it */
const PAD_SHOW_PX = 260;
const TOP_BAR_PX = 110;
const TOP_GAP_PX = 8;

/** pad: the sheet's height with the keyboard up (unit-tested): its own height, or taller so about PAD_SHOW_PX of it shows
 *  above the keyboard (`full`: as tall as it can be), but never up under the top bar (`topBar`: its bottom). */
export function padHeight(p: { natural: number; kbH: number; fullH: number; topBar?: number; full?: boolean }): number {
  const most = p.fullH - (p.topBar ?? TOP_BAR_PX);
  return Math.round(p.full ? Math.max(p.natural, most) : Math.max(p.natural, Math.min(p.kbH + PAD_SHOW_PX, most)));
}

/** the bottom of the screen's top bar (the 人物 / 設定 buttons) plus a gap, unpanned; undefined when there is none */
function topBarBottom(pan: number): number | undefined {
  const bar = document.querySelector('.tutor-top');
  return bar ? Math.round(bar.getBoundingClientRect().bottom - pan + TOP_GAP_PX) : undefined;
}

/** a field that brings up the text keyboard */
function isTextField(t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement {
  if (t instanceof HTMLTextAreaElement) return true;
  return t instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', 'number', 'password', ''].includes(t.type);
}

export function useSheetKeyboard(backdropRef: RefObject<HTMLElement | null>, sheetRef: RefObject<HTMLElement | null>,
  opts: { anchor?: RefObject<HTMLElement | null>; body?: RefObject<HTMLElement | null>; full?: boolean }) {
  const { anchor, body, full } = opts;
  const st = useRef({
    lift: false, liftTimer: 0, raf: 0, settleUntil: 0, key: '', shift: 0, pan: 0,
    field: null as HTMLInputElement | HTMLTextAreaElement | null, shown: null as Element | null, natural: 0,
  });
  const [open, setOpen] = useState(false); // the keyboard is up over this sheet

  const unlift = useCallback(() => {
    const s = st.current;
    clearTimeout(s.liftTimer);
    if (!s.lift) return;
    s.lift = false;
    s.field?.classList.remove('kb-lift');
  }, []);

  const apply = useCallback(() => {
    const el = backdropRef.current, sheet = sheetRef.current, s = st.current;
    if (!el || !sheet) return;
    const vv = window.visualViewport;
    const field = s.field && document.activeElement === s.field ? s.field : null;
    // the field row where it would be with no raise and no pan undo (both added back); with the app moved down by the pan,
    // the view's coordinates are the screen's, so the keyboard's top is at the visible height (vvTop 0 below)
    const anchorBottom = anchor?.current ? anchor.current.getBoundingClientRect().bottom + s.shift - s.pan : 0;
    const box = sheetLift({ focused: !!field, fullH: window.innerHeight, vvH: vv?.height ?? window.innerHeight, vvTop: 0, scale: vv?.scale, anchorBottom });
    const pan = box ? Math.max(0, Math.round(vv?.offsetTop ?? 0)) : 0;
    const key = box ? `${box.kbTop}/${box.shift}/${pan}` : '';
    if (key !== s.key) {
      const was = !!s.key;
      if (!!box !== was) {
        el.classList.toggle('kb-open', !!box);
        setOpen(!!box);
        // pad: the sheet keeps the height it had (a short one grows, padHeight); the padding (below) then shortens its body
        if (body && box) { s.natural = sheet.offsetHeight; sheet.style.boxSizing = 'border-box'; sheet.style.maxHeight = 'none'; }
        if (!box) { sheet.style.height = ''; sheet.style.maxHeight = ''; sheet.style.boxSizing = ''; sheet.style.paddingBottom = ''; s.shown = null; }
      }
      s.key = key;
      s.shift = box?.shift ?? 0;
      el.style.setProperty('--kb-top', box ? `${box.kbTop}px` : '');
      if (anchor) sheet.style.transform = box?.shift ? `translate3d(0, ${-box.shift}px, 0)` : '';
      if (body && box) {
        const kbH = Math.max(0, window.innerHeight - box.kbTop);
        sheet.style.height = `${padHeight({ natural: s.natural, kbH, fullH: window.innerHeight, topBar: topBarBottom(s.pan), full })}px`;
        sheet.style.paddingBottom = `${kbH + 10}px`;
      }
      const root = document.getElementById('root');
      if (root && pan !== s.pan) root.style.transform = pan ? `translate3d(0, ${pan}px, 0)` : '';
      s.pan = pan;
    }
    if (box && s.lift) requestAnimationFrame(() => { if (st.current.key) unlift(); });
    // pad: once the field is back in place, scroll it into view inside the body (once per field, so the player can scroll)
    const scroller = body?.current;
    if (box && scroller && field && !s.lift && s.shown !== field) {
      const f = field.getBoundingClientRect(), b = scroller.getBoundingClientRect();
      scroller.scrollTop += scrollToShow({ fieldTop: f.top, fieldBottom: f.bottom, bodyTop: b.top, bodyBottom: b.bottom });
      s.shown = field;
    }
    if (!field && !box) {
      document.documentElement.classList.remove('kb-lock');
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    }
  }, [backdropRef, sheetRef, anchor, body, full, unlift]);

  const schedule = useCallback(() => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(() => {
      apply();
      if (performance.now() < s.settleUntil) schedule();
    });
  }, [apply]);
  /** re-measure for a while (the keyboard animates ~0.3 s; vv events can lag); `now` also measures this frame */
  const settle = useCallback((now: boolean) => {
    st.current.settleUntil = performance.now() + SETTLE_MS;
    if (now) apply();
    schedule();
  }, [apply, schedule]);

  /** put on the sheet: React's focus events bubble, so every text field inside is handled */
  const onFocus = useCallback((ev: FocusEvent) => {
    const s = st.current, t = ev.target;
    if (!isTextField(t)) return;
    s.field = t;
    if (isIOS) {
      document.documentElement.classList.add('kb-lock');
      if (!s.key) {
        s.lift = true;
        t.classList.add('kb-lift'); // synchronously, before WebKit asks where the focused element is
        clearTimeout(s.liftTimer);
        s.liftTimer = window.setTimeout(unlift, LIFT_MAX_MS);
      }
    }
    settle(true);
  }, [unlift, settle]);
  const onBlur = useCallback((ev: FocusEvent) => {
    if (!isTextField(ev.target)) return;
    unlift();
    settle(false); // a frame later: another field may have taken the focus by then
  }, [unlift, settle]);

  useEffect(() => {
    const vv = window.visualViewport;
    const s = st.current;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    // keyboard up: a drag on the sheet would pan the page (the scroll bar showed); only the body may scroll then
    const el = backdropRef.current;
    const noDrag = (ev: TouchEvent) => {
      if (st.current.key && !(body?.current && ev.target instanceof Node && body.current.contains(ev.target))) ev.preventDefault();
    };
    el?.addEventListener('touchmove', noDrag, { passive: false });
    return () => {
      el?.removeEventListener('touchmove', noDrag);
      window.removeEventListener('scroll', schedule);
      if (s.pan) { const root = document.getElementById('root'); if (root) root.style.transform = ''; s.pan = 0; }
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(s.raf);
      clearTimeout(s.liftTimer);
      // closed while typing: no blur comes, so undo the lock and any scroll here (the chat bar cannot be focused under a sheet)
      document.documentElement.classList.remove('kb-lock');
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    };
  }, [schedule, backdropRef, body]);

  return { onFocus, onBlur, open };
}
