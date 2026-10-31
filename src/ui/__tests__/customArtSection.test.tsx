// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomArtSection } from '../SettingsSections';
import { clearCustomArt, saveCustomArt, type CustomArt, type CustomArtFrame } from '../../game/customArt';
import type { VisemeCode } from '../../game/visemes';

// the storage is mocked: no IndexedDB in jsdom
vi.mock('../../game/customArt', async (orig) => ({
  ...(await orig<typeof import('../../game/customArt')>()),
  saveCustomArt: vi.fn(async () => {}),
  clearCustomArt: vi.fn(async () => {}),
}));

function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const fr = (id: string, viseme: VisemeCode | null): CustomArtFrame => ({ id, viseme, blob: new Blob([id], { type: 'image/webp' }) });
const framesArt = (...vs: VisemeCode[]): CustomArt => ({ mode: 'frames', frames: vs.map((v, i) => fr(`f${i}`, v)) });
const choices = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.as-seg button')];

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(saveCustomArt).mockClear();
  vi.mocked(clearCustomArt).mockClear();
});

describe('CustomArtSection (人設圖片)', () => {
  it('has the heading and the three choices; the hamster is chosen when there is no picture', () => {
    const r = render(<CustomArtSection art={null} onChange={() => {}} />);
    expect(r.host.querySelector('h3')?.textContent).toBe('人設圖片');
    expect(choices(r.host).map((b) => b.textContent)).toEqual(['預設倉鼠', '單張圖', '序列圖']);
    expect(choices(r.host).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    r.unmount();
  });

  it('shows the privacy note with the mouth-shape rules', () => {
    const r = render(<CustomArtSection art={null} onChange={() => {}} />);
    expect(r.host.textContent).toContain('圖片只存在這台裝置的瀏覽器裡，不會上傳。');
    expect(r.host.textContent).toContain('講話時依嘴型 a／e／i／o／u 換圖，沒說話時用 m；缺的母音用 a。');
    r.unmount();
  });

  it('a frames picture with fewer than two frames shows the at-least-two note', () => {
    const r = render(<CustomArtSection art={framesArt('a')} onChange={() => {}} />);
    expect(choices(r.host)[2].getAttribute('aria-checked')).toBe('true');
    expect(r.host.textContent).toContain('至少兩張才能用序列圖');
    r.unmount();
  });

  it('no at-least-two note once there are two frames', () => {
    const r = render(<CustomArtSection art={framesArt('a', 'e')} onChange={() => {}} />);
    expect(r.host.textContent).not.toContain('至少兩張才能用序列圖');
    expect(r.host.querySelectorAll('li.as-custom-frame')).toHaveLength(2);
    r.unmount();
  });

  it('a shape used by one frame is disabled in the other frames', () => {
    const r = render(<CustomArtSection art={framesArt('a', 'e')} onChange={() => {}} />);
    const [first, second] = [...r.host.querySelectorAll<HTMLSelectElement>('select.as-custom-shape')];
    const off = (s: HTMLSelectElement) => Object.fromEntries([...s.options].map((o) => [o.value, o.disabled]));
    expect(off(first)).toEqual({ a: false, e: true, i: false, o: false, u: false, m: false });
    expect(off(second)).toEqual({ a: true, e: false, i: false, o: false, u: false, m: false });
    r.unmount();
  });

  it('caps the frames at six: the add button is disabled then', () => {
    const five = render(<CustomArtSection art={framesArt('a', 'e', 'i', 'o', 'u')} onChange={() => {}} />);
    const add5 = [...five.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '新增一張');
    expect(add5?.disabled).toBe(false);
    five.unmount();

    const six = render(<CustomArtSection art={framesArt('a', 'e', 'i', 'o', 'u', 'm')} onChange={() => {}} />);
    const add6 = [...six.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '新增一張');
    expect(add6?.disabled).toBe(true);
    expect(six.host.querySelectorAll('li.as-custom-frame')).toHaveLength(6);
    expect(six.host.textContent).toContain('6 / 6 張');
    six.unmount();
  });

  it('a single picture shows its thumbnail and the picker', () => {
    const art: CustomArt = { mode: 'single', frames: [fr('one', null)] };
    const r = render(<CustomArtSection art={art} onChange={() => {}} />);
    expect(choices(r.host)[1].getAttribute('aria-checked')).toBe('true');
    expect(r.host.querySelector('img.as-custom-thumb')).toBeTruthy();
    const input = r.host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
    expect([...r.host.querySelectorAll('button')].some((b) => b.textContent === '選擇圖片')).toBe(true);
    r.unmount();
  });

  it('恢復預設 is disabled without a picture, and clears the stored picture when there is one', async () => {
    const onChange = vi.fn();
    const none = render(<CustomArtSection art={null} onChange={onChange} />);
    const resetNone = [...none.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '恢復預設');
    expect(resetNone?.disabled).toBe(true);
    none.unmount();

    const mine = render(<CustomArtSection art={framesArt('a', 'e')} onChange={onChange} />);
    const reset = [...mine.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '恢復預設');
    expect(reset?.disabled).toBe(false);
    await act(async () => { reset?.click(); });
    expect(clearCustomArt).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);
    mine.unmount();
  });

  it('switching from one picture to frames keeps the picture as the a frame (saved)', async () => {
    const onChange = vi.fn();
    const art: CustomArt = { mode: 'single', frames: [fr('one', null)] };
    const r = render(<CustomArtSection art={art} onChange={onChange} />);
    await act(async () => { choices(r.host)[2].click(); });
    expect(saveCustomArt).toHaveBeenCalledWith({ mode: 'frames', frames: [{ id: 'one', viseme: 'a', blob: art.frames[0].blob }] }, 'mugi');
    expect(onChange).toHaveBeenCalled();
    r.unmount();
  });

  it('a save that the browser refuses shows its message and keeps the old picture', async () => {
    vi.mocked(clearCustomArt).mockRejectedValueOnce(new Error('無法清除圖片，請再試一次'));
    const onChange = vi.fn();
    const r = render(<CustomArtSection art={framesArt('a', 'e')} onChange={onChange} />);
    const reset = [...r.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '恢復預設');
    await act(async () => { reset?.click(); });
    expect(r.host.querySelector('.as-custom-err')?.textContent).toContain('無法清除圖片，請再試一次');
    expect(onChange).not.toHaveBeenCalled();
    r.unmount();
  });
});
