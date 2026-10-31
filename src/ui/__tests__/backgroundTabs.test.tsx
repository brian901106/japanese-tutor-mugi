// @vitest-environment jsdom
// The 背景 part of the 人物 sheet: the tabs 教室, 純黑, the added ones and ＋. ＋ takes PNG, JPEG or WebP (an SVG is refused) and makes
// the new background the one in use; an added one has 刪除這張背景 (after the player confirms); at most 6 added. 背景變暗 is the dimming of
// the one in use (none for 純黑). The storage is mocked: no IndexedDB in jsdom.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BackgroundSection } from '../SettingsSections';
import { clearBackgroundPicture, saveBackgroundPicture } from '../../game/tutorBackground';

vi.mock('../../game/tutorBackground', async (orig) => ({
  ...(await orig<typeof import('../../game/tutorBackground')>()),
  saveBackgroundPicture: vi.fn(async () => {}),
  clearBackgroundPicture: vi.fn(async () => {}),
  prepareBackground: vi.fn(async () => new Blob(['webp'], { type: 'image/webp' })),
}));

type Props = Parameters<typeof BackgroundSection>[0];
const base: Props = {
  active: 'classroom', added: [], pictures: {}, dim: 0,
  onSelect: () => {}, onAdded: () => {}, onDeleted: () => {}, onDim: () => {},
};

function render(props: Partial<Props>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<BackgroundSection {...base} {...props} />));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const byLabel = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${label}"]`);
const plusButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="新增背景"]')!;
const deleteButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '刪除這張背景') ?? null;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:bg');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(saveBackgroundPicture).mockClear();
  vi.mocked(clearBackgroundPicture).mockClear();
  vi.unstubAllGlobals();
});

describe('the 背景 tabs', () => {
  it('shows 教室, 純黑 and ＋; the classroom is the one in use', () => {
    const r = render({});
    expect(r.host.querySelector('h3')?.textContent).toBe('背景圖片');
    expect(tabs(r.host).map((b) => b.getAttribute('aria-label'))).toEqual(['教室', '純黑']);
    expect(byLabel(r.host, '教室')!.getAttribute('aria-checked')).toBe('true');
    expect(plusButton(r.host)).not.toBeNull();
    expect(deleteButton(r.host)).toBeNull(); // the built-in ones cannot be deleted
    r.unmount();
  });

  it('an added background has its own tab after 純黑 and is the one in use when active', () => {
    const r = render({ active: 'b1', added: ['b1', 'b2'], pictures: { b1: new Blob(['x']), b2: null } });
    expect(tabs(r.host).map((b) => b.getAttribute('aria-label'))).toEqual(['教室', '純黑', '自訂 1', '自訂 2']);
    expect(byLabel(r.host, '自訂 1')!.getAttribute('aria-checked')).toBe('true');
    expect(deleteButton(r.host)).not.toBeNull();
    r.unmount();
  });

  it('a tab sends its background id through onSelect', () => {
    const onSelect = vi.fn();
    const r = render({ added: ['b1'], pictures: { b1: null }, onSelect });
    byLabel(r.host, '純黑')!.click();
    expect(onSelect).toHaveBeenLastCalledWith('black');
    byLabel(r.host, '自訂 1')!.click();
    expect(onSelect).toHaveBeenLastCalledWith('b1');
    r.unmount();
  });

  it('＋ is off at the maximum of 6 added backgrounds', () => {
    const six = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
    const r = render({ added: six, pictures: {} });
    expect(plusButton(r.host).disabled).toBe(true);
    r.unmount();
    const r2 = render({ added: six.slice(0, 5), pictures: {} });
    expect(plusButton(r2.host).disabled).toBe(false);
    r2.unmount();
  });
});

describe('adding a background (＋)', () => {
  it('the picker takes PNG, JPEG and WebP only: an SVG is refused with its message and nothing is stored', async () => {
    const onAdded = vi.fn();
    const r = render({ onAdded });
    const input = r.host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe('image/png,image/jpeg,image/webp');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['<svg/>'], 'bg.svg', { type: 'image/svg+xml' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(r.host.textContent).toContain('SVG 圖不收，請換成 PNG、JPG 或 WebP');
    expect(saveBackgroundPicture).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    r.unmount();
  });

  it('a picked picture is stored under a new id and reported with it', async () => {
    const onAdded = vi.fn();
    const r = render({ onAdded });
    const input = r.host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['png'], 'room.png', { type: 'image/png' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(saveBackgroundPicture).toHaveBeenCalledTimes(1);
    const [blob, id] = vi.mocked(saveBackgroundPicture).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(id).toMatch(/^b[0-9a-z]+$/);
    expect(onAdded).toHaveBeenCalledWith(id, blob);
    r.unmount();
  });
});

describe('deleting an added background', () => {
  it('after the player confirms, its picture is removed and onDeleted gets its id', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const onDeleted = vi.fn();
    const r = render({ active: 'b1', added: ['b1'], pictures: { b1: null }, onDeleted });
    await act(async () => { deleteButton(r.host)!.click(); });
    expect(clearBackgroundPicture).toHaveBeenCalledWith('b1');
    expect(onDeleted).toHaveBeenCalledWith('b1');
    r.unmount();
  });

  it('a refused confirmation deletes nothing', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const onDeleted = vi.fn();
    const r = render({ active: 'b1', added: ['b1'], pictures: { b1: null }, onDeleted });
    await act(async () => { deleteButton(r.host)!.click(); });
    expect(clearBackgroundPicture).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    r.unmount();
  });
});

describe('背景變暗 (the dimming of the one in use)', () => {
  it('the slider runs 0 to 60 and sends the new share', () => {
    const onDim = vi.fn();
    const r = render({ active: 'classroom', dim: 25, onDim });
    const slider = r.host.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('60');
    expect(r.host.textContent).toContain('背景變暗25%');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setValue.call(slider, '40'); slider.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onDim).toHaveBeenLastCalledWith(40);
    r.unmount();
  });

  it('there is no dimming slider for plain black', () => {
    const r = render({ active: 'black' });
    expect(r.host.querySelector('input[type="range"]')).toBeNull();
    r.unmount();
  });
});
