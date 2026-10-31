// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IconCheck, IconChat, IconChevronDown, IconChevronLeft, IconChevronRight, IconClose, IconGear, IconMic, IconSpeaker, IconStop, IconTalk,
} from '../icons';

const ICONS = { IconCheck, IconChat, IconChevronDown, IconChevronLeft, IconChevronRight, IconClose, IconGear, IconMic, IconSpeaker, IconStop, IconTalk };

function renderSvg(el: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  const svg = host.querySelector('svg');
  return { svg, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('button icons', () => {
  for (const [name, Icon] of Object.entries(ICONS)) {
    it(`${name} renders a decorative svg in the shared style`, () => {
      const r = renderSvg(<Icon />);
      expect(r.svg).not.toBeNull();
      expect(r.svg!.getAttribute('aria-hidden')).toBe('true');
      expect(r.svg!.getAttribute('focusable')).toBe('false');
      expect(r.svg!.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(r.svg!.getAttribute('stroke')).toBe('currentColor');
      expect(r.svg!.getAttribute('width')).toBe('22');
      expect(r.svg!.getAttribute('height')).toBe('22');
      r.unmount();
    });
  }

  it('size prop sets the svg width and height', () => {
    const r = renderSvg(<IconClose size={18} />);
    expect(r.svg!.getAttribute('width')).toBe('18');
    expect(r.svg!.getAttribute('height')).toBe('18');
    r.unmount();
  });

  it('no icon carries text, so a button made of one has no text content', () => {
    const r = renderSvg(<IconGear />);
    expect(r.svg!.textContent).toBe('');
    r.unmount();
  });
});

describe('no emoji or symbol characters left in button text', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // pictographs and symbols the old buttons used (and the chevrons of the usage panel), plus the emoji variation selector
  const FORBIDDEN = ['\u{1F4AC}', '\u{1F5E3}', '\u{1F3A4}', '\u{1F50A}', '⚙', '✕', '▾', '■', '‹', '›', '️'];

  /** the source with its comments taken out: block comments (also the JSX {/* … *\/} kind) and // line comments */
  function withoutComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  it('scans the ui .tsx files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const f of files) {
    it(`${f} has no forbidden symbol outside comments`, () => {
      const code = withoutComments(fs.readFileSync(path.join(dir, f), 'utf8'));
      const hits = FORBIDDEN.filter((ch) => code.includes(ch));
      expect(hits).toEqual([]);
    });
  }
});
