// The server's LLM seam (server/llm): the Anthropic provider sends the request shape chatRequest builds, and its errors map
// to the messages the player sees. Nothing calls a model: the Anthropic client is a fake.
import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { CHAT_REPLY_SCHEMA, chatRequest, describeError, parseChatBody } from '../../../server/claudeChat.ts';
import { anthropicProvider, describeAnthropicError } from '../../../server/llm/anthropicProvider.ts';
import { JUDGE_PROMPT, reminderPrompt, systemPrompt } from '../../../server/prompts.ts';

const final = { content: [{ type: 'text', text: '嗨' }], model: 'claude-test', usage: { input_tokens: 1, output_tokens: 2 }, stop_reason: 'end_turn' };

/** A fake Anthropic client: messages.stream yields one text delta and finishes with `final`; messages.create returns `final`. */
function fakeClient() {
  const abort = vi.fn();
  const stream = vi.fn((_params: unknown) => ({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '嗨' } };
    },
    finalMessage: async () => final,
    abort,
  }));
  const create = vi.fn(async (_params: unknown, _opts?: unknown) => final);
  return { client: { beta: { messages: { stream, create } } } as unknown as Anthropic, stream, create, abort };
}

const sample = parseChatBody(JSON.stringify({
  messages: [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'B' }, { role: 'user', content: 'C' }],
  role: 'Mugi', mode: 'teacher', context: {},
}));

describe('anthropic provider: the chat request shape (reply schema, system block, reminder)', () => {
  it('the chat stream gets exactly the request chatRequest builds (JSON schema, system block, breakpoint, reminder)', async () => {
    const expected = {
      model: 'claude-test',
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CHAT_REPLY_SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: systemPrompt('Mugi'), cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: [{ type: 'text', text: 'B', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: `C\n\n<reminder>${reminderPrompt()}</reminder>` },
      ],
    };
    const { client, stream, create } = fakeClient();
    const onDelta = vi.fn();
    const s = anthropicProvider(client).streamChat(chatRequest(sample, 'claude-test'), onDelta);
    const r = await s.done;
    expect(stream).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(stream.mock.calls[0][0]).toEqual(expected);
    expect(onDelta).toHaveBeenCalledWith('嗨');
    expect(r).toEqual({ text: '嗨', model: 'claude-test', usage: final.usage, stopReason: 'end_turn' });
  });

  it('the abort reaches the upstream stream', () => {
    const { client, abort } = fakeClient();
    anthropicProvider(client).streamChat(chatRequest(sample, 'claude-test'), () => {}).abort();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('a one-shot call (the judge) keeps its params and sends no timeout', async () => {
    const { client, create } = fakeClient();
    const params = {
      model: 'claude-test', max_tokens: 2000,
      output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: { type: 'object' } } },
      system: JUDGE_PROMPT, messages: [{ role: 'user' as const, content: '目標：x\n他說：y' }],
    };
    const r = await anthropicProvider(client).complete(params);
    expect(create.mock.calls[0][0]).toEqual(params);
    expect(create.mock.calls[0][1]).toBeUndefined();
    expect(r.text).toBe('嗨');
    expect(r.model).toBe('claude-test');
  });

  it('upstream errors map to the same messages as before', () => {
    expect(describeAnthropicError(new Error('boom'))).toEqual({ status: 500, message: 'boom' });
    expect(describeError(new Error('boom'))).toEqual({ status: 500, message: 'boom' });
    expect(anthropicProvider({} as Anthropic).describeError(new Error('x'))).toEqual({ status: 500, message: 'x' });
  });
});
