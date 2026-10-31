import { describe, expect, it } from 'vitest';
import { CHAT_ROLES } from '../claudeProtocol';
import { TUTOR_CHARACTER } from '../tutorCharacters';
import { TUTOR_DEFAULT_NAME } from '../tutor';
import { systemPrompt } from '../../../server/prompts.ts';

describe('the teacher: むぎ', () => {
  it('is the one character, with her role, default name, subtitle and art folder', () => {
    expect(TUTOR_CHARACTER).toMatchObject({
      id: 'mugi', role: 'Mugi', artDir: 'characters/mugi', defaultName: 'むぎ', subtitle: '倉鼠・日語家教',
    });
    expect(TUTOR_DEFAULT_NAME).toBe(TUTOR_CHARACTER.defaultName);
  });
  it('her role is one the server accepts, and it is the only role', () => {
    expect(CHAT_ROLES).toEqual(['Mugi']);
    expect(CHAT_ROLES).toContain(TUTOR_CHARACTER.role);
  });
});

describe('the persona of むぎ, the hamster (server/prompts.ts)', () => {
  it('is named むぎ by default, is stable per call, and is a teacher with the same rules', () => {
    const a = systemPrompt('Mugi');
    expect(a).toContain('你是「むぎ」');
    expect(a).toBe(systemPrompt('Mugi'));
    expect(a).toContain('segments');
    expect(a).toContain('tip');
    expect(a).toContain('tone');
  });
  it('is cute and playful in tone, talks about everyday life, and keeps the hamster to the manner', () => {
    const a = systemPrompt('Mugi');
    expect(a).toContain('可愛');
    expect(a).toContain('日常生活');
    expect(a).toContain('不會硬把話題轉到倉鼠身上');
    expect(a).toContain('絕不涉及色情');
  });
});
