// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelSection, PersonaSection } from '../SettingsSections';
import { PERSONA_MAX_CHARS } from '../../game/claudeProtocol';

function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}
const labels = (host: HTMLElement) => [...host.querySelectorAll('.as-row > span:first-child')].map((s) => s.childNodes[0]?.textContent);

describe('ModelSection (Claude 模型)', () => {
  it('has the heading, the chat rows (server first), the helper rows and the cost note', () => {
    const r = render(<ModelSection chatModel="" helperModel="claude-haiku-5-5" serverModel="claude-haiku-5-5" onChange={() => {}} />);
    expect(r.host.querySelector('h3')?.textContent).toBe('Claude 模型');
    expect(labels(r.host)).toEqual([
      '依伺服器設定（目前：Haiku 5.5）', 'Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5', 'Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5',
    ]);
    expect(r.host.textContent).toContain('MUGI_DAILY_USD');
    expect(r.host.textContent).toContain('Anthropic Console');
    r.unmount();
  });

  it('shows the server model as 讀取中… until the status is read', () => {
    const r = render(<ModelSection chatModel="" helperModel="claude-haiku-5-5" serverModel={null} onChange={() => {}} />);
    expect(labels(r.host)[0]).toBe('依伺服器設定（目前：讀取中…）');
    r.unmount();
  });

  it('marks the chosen models', () => {
    const r = render(<ModelSection chatModel="claude-opus-5-5" helperModel="claude-sonnet-5-5" serverModel="claude-haiku-5-5" onChange={() => {}} />);
    const checked = [...r.host.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')].map((i) => `${i.name}=${i.value}`);
    expect(checked).toEqual(['chat-model=claude-opus-5-5', 'helper-model=claude-sonnet-5-5']);
    r.unmount();
  });

  it('a click on a chat model reports that model; the server choice reports an empty id', () => {
    const onChange = vi.fn();
    const r = render(<ModelSection chatModel="claude-haiku-5-5" helperModel="claude-haiku-5-5" serverModel="claude-haiku-5-5" onChange={onChange} />);
    r.host.querySelector<HTMLInputElement>('input[name="chat-model"][value="claude-opus-5-5"]')?.click();
    expect(onChange).toHaveBeenLastCalledWith({ chatModel: 'claude-opus-5-5' });
    r.host.querySelector<HTMLInputElement>('input[name="chat-model"][value="claude-opus-5-5"]')?.click();
    r.unmount();
    const again = render(<ModelSection chatModel="claude-opus-5-5" helperModel="claude-haiku-5-5" serverModel="claude-haiku-5-5" onChange={onChange} />);
    again.host.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
    expect(onChange).toHaveBeenLastCalledWith({ chatModel: '' });
    again.unmount();
  });

  it('a click on a 速查 / 小提醒 model reports the helper model', () => {
    const onChange = vi.fn();
    const r = render(<ModelSection chatModel="" helperModel="claude-haiku-5-5" serverModel="claude-haiku-5-5" onChange={onChange} />);
    r.host.querySelector<HTMLInputElement>('input[name="helper-model"][value="claude-sonnet-5-5"]')?.click();
    expect(onChange).toHaveBeenLastCalledWith({ helperModel: 'claude-sonnet-5-5' });
    r.unmount();
  });
});

describe('PersonaSection (人設)', () => {
  it('fills the box with the default personality (editable in place), with the limit and the remaining count', () => {
    const r = render(<PersonaSection persona="" defaultPersona="元氣可愛的倉鼠" onChange={() => {}} />);
    expect(r.host.querySelector('h3')?.textContent).toBe('人設');
    const area = r.host.querySelector<HTMLTextAreaElement>('textarea.as-persona');
    expect(area?.value).toBe('元氣可愛的倉鼠');
    expect(area?.placeholder).toBe('元氣可愛的倉鼠');
    // no maxLength attribute: the limit counts code points (PersonaSection clips), not UTF-16 units
    expect(area?.getAttribute('maxlength')).toBeNull();
    expect(r.host.textContent).toContain(`剩 ${PERSONA_MAX_CHARS - 7} 字`);
    expect(r.host.textContent).toContain('回覆格式、教學規則不會被改掉');
    r.unmount();
  });

  it('counts the remaining characters of a persona of its own', () => {
    const r = render(<PersonaSection persona="冷靜的老師" defaultPersona="" onChange={() => {}} />);
    expect(r.host.querySelector<HTMLTextAreaElement>('textarea.as-persona')?.value).toBe('冷靜的老師');
    expect(r.host.textContent).toContain(`剩 ${PERSONA_MAX_CHARS - 5} 字`);
    r.unmount();
  });

  it('an edit of the default is saved; the default text itself and an empty box are saved as the default (empty)', () => {
    const onChange = vi.fn();
    const r = render(<PersonaSection persona="" defaultPersona="元氣可愛的倉鼠" onChange={onChange} />);
    const area = r.host.querySelector<HTMLTextAreaElement>('textarea.as-persona')!;
    const type = (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, v);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    type('元氣可愛的倉鼠，很愛吃瓜子');
    expect(onChange).toHaveBeenLastCalledWith('元氣可愛的倉鼠，很愛吃瓜子');
    type('元氣可愛的倉鼠');
    expect(onChange).toHaveBeenLastCalledWith('');
    type('');
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(area.value).toBe('');
    r.unmount();
  });

  it('恢復預設 is disabled for the default, and clears the persona when there is one', () => {
    const onChange = vi.fn();
    const none = render(<PersonaSection persona="" defaultPersona="x" onChange={onChange} />);
    expect(none.host.querySelector<HTMLButtonElement>('button.as-small')?.disabled).toBe(true);
    none.unmount();
    const mine = render(<PersonaSection persona="冷靜的老師" defaultPersona="x" onChange={onChange} />);
    const btn = mine.host.querySelector<HTMLButtonElement>('button.as-small');
    expect(btn?.textContent).toBe('恢復預設');
    expect(btn?.disabled).toBe(false);
    btn?.click();
    expect(onChange).toHaveBeenCalledWith('');
    mine.unmount();
  });
});
