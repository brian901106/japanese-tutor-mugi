// The Anthropic backend (the only one): the only place that calls the Anthropic SDK. The calls are the ones claudeChat always made:
// messages.stream for the chat (params exactly as chatRequest built them), messages.create for the one-shot helpers.
import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeUsage } from '../usage.ts';
import type { LlmCompleteOptions, LlmCompleteRequest, LlmChatRequest, LlmProvider, LlmResult, LlmStream } from './provider.ts';
import { defaultDescribeError } from './provider.ts';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** the whole chat reply (stream included) must finish within this long, or it is cut off (a stuck upstream holds a slot) */
export const CHAT_STREAM_TIMEOUT_MS = 120_000;

/** Upstream failure → HTTP status + a message for the player (never the key). */
export function describeAnthropicError(e: unknown): { status: number; message: string } {
  if (e instanceof Anthropic.AuthenticationError) return { status: 401, message: 'API 金鑰無效' };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, message: '請求太頻繁，稍後再試' };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, message: '連不上 Claude' };
  if (e instanceof Anthropic.APIError) return { status: e.status ?? 502, message: `Claude 回應錯誤（${e.status ?? '未知'}）：${e.message}` };
  return defaultDescribeError(e);
}

/** the SDK's params: the request without schemaName, which only the OpenAI provider uses */
function sdkParams<T extends object>(req: T & { schemaName?: string }): T {
  const { schemaName, ...params } = req;
  void schemaName;
  return params as T;
}

const textOf = (content: { type: string; text?: string }[]): string =>
  content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('');

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;

/** the usage so far with the newer numbers of an event laid over it (a field the event leaves out keeps its value) */
export function mergeUsage(prev: ClaudeUsage | undefined, next: ClaudeUsage | null | undefined): ClaudeUsage | undefined {
  if (!next) return prev;
  const out: ClaudeUsage = { ...prev };
  for (const k of USAGE_KEYS) {
    const v = next[k];
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

export function anthropicProvider(client: Anthropic): LlmProvider {
  return {
    id: 'anthropic',
    streamChat(req: LlmChatRequest, onDelta: (text: string) => void): LlmStream {
      const stream = client.beta.messages.stream(sdkParams<BetaMessageStreamParams>(req));
      let seen: ClaudeUsage | undefined;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stream.abort();
      }, CHAT_STREAM_TIMEOUT_MS);
      const done = (async (): Promise<LlmResult> => {
        try {
          for await (const event of stream) {
            if (event.type === 'message_start') seen = mergeUsage(seen, event.message.usage);
            else if (event.type === 'message_delta') seen = mergeUsage(seen, event.usage);
            else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onDelta(event.delta.text);
          }
          const final = await stream.finalMessage();
          return { text: textOf(final.content), model: final.model, usage: final.usage, stopReason: final.stop_reason };
        } catch (e) {
          if (timedOut) throw new Error('Claude 回應逾時，已中止');
          throw e;
        } finally {
          clearTimeout(timer);
        }
      })();
      return { abort: () => stream.abort(), done, usageSoFar: () => seen };
    },
    async complete(req: LlmCompleteRequest, opts?: LlmCompleteOptions): Promise<LlmResult> {
      const msg = await client.beta.messages.create(sdkParams(req), opts);
      return { text: textOf(msg.content), model: msg.model, usage: msg.usage, stopReason: msg.stop_reason };
    },
    describeError: describeAnthropicError,
  };
}
