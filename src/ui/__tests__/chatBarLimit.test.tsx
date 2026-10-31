// @vitest-environment jsdom
// The chat box's length cap (ChatBar maxChars): typing past it is cut in code points (a pair is one character), and the counter
// shows only within 100 of the cap.
import { describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatBar, type ChatBarProps } from '../ChatBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(over: Partial<ChatBarProps>) {
  const props: ChatBarProps = {
    inputRef: createRef<HTMLInputElement>(), value: '', onChange: () => {}, placeholder: '和她說話…',
    onSubmit: () => {}, chatOpen: false, onToggleChat: () => {},
    voice: { active: false, onToggle: () => {} }, mic: { listening: false, supported: true, onToggle: () => {} },
    ...over,
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<ChatBar {...props} />));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('ChatBar length cap', () => {
  it('typing past maxChars is cut to the cap, counted in code points (an emoji is one)', () => {
    const onChange = vi.fn();
    const r = render({ value: '', onChange, maxChars: 3 });
    const input = r.host.querySelector<HTMLInputElement>('input[aria-label="訊息"]')!;
    // a pasted run of five emoji: the cut keeps three whole emoji, never half of a pair
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '😀😀😀😀😀');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('😀😀😀');
    r.unmount();
  });

  it('the counter shows only within 100 characters of the cap', () => {
    const far = render({ value: 'あ'.repeat(10), maxChars: 1900 });
    expect(far.host.querySelector('.as-count')).toBeNull();
    far.unmount();
    const near = render({ value: 'あ'.repeat(1850), maxChars: 1900 });
    expect(near.host.querySelector('.as-count')?.textContent).toBe('1850 / 1900 字');
    near.unmount();
  });
});
