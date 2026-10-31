// The hands-free voice conversation as a pure state machine (no React, no browser APIs: the caller injects them).
//
//   off ──start──▶ listening ──final text──▶ thinking ──reply speaking──▶ speaking
//                     ▲                          │                           │
//                     └──── 300 ms after the reply is done and spoken ◀──────┘
//
// Rules: she is never listened to while she speaks (the mic stops when speech starts); a tap on the button while she
// speaks is barge-in (speech stops, listening starts); a tap otherwise stops the loop; two silent listening sessions in a
// row stop the loop with a hint; a browser without speech recognition stops it with a note (TTS keeps working).
import type { ReplyEvent } from '../game/replyBus';
import { speechErrorText } from './useSpeechInput';

export type VoicePhase = 'off' | 'listening' | 'thinking' | 'speaking';

export const VOICE_TIMING = { pause: 300, thinkMax: 90_000 } as const;
export const NO_SPEECH_LIMIT = 2;
export const VOICE_UNSUPPORTED_TEXT = '此環境不支援即時語音辨識。可改用 Safari 分頁開啟，或用鍵盤聽寫輸入；她的回覆仍會朗讀。';
export const VOICE_NO_SPEECH_TEXT = '好像沒聽到聲音，語音對話已暫停';

export interface VoiceDeps {
  /** the browser has a recognition constructor */
  supported: boolean;
  startRec(): void;
  /** graceful stop: a final text may still arrive (the machine ignores it when it is no longer listening) */
  stopRec(): void;
  /** the speech queue is not empty */
  isSpeaking(): boolean;
  stopSpeech(): void;
  /** the typed-message path of the chat (the same function the text box uses) */
  send(text: string): void | Promise<void>;
  note(text: string): void;
  onPhase(p: VoicePhase): void;
  /** runs `fn` after `ms`; returns the cancel */
  schedule(fn: () => void, ms: number): () => void;
}

export interface VoiceChat {
  phase(): VoicePhase;
  start(): void;
  stop(): void;
  /** while she speaks: stop her and listen; while listening / thinking: stop the loop; while off: start */
  toggle(): void;
  bargeIn(): void;
  onRecPartial(text: string): void;
  onRecFinal(text: string): void;
  onRecEnd(gotFinal: boolean): void;
  onRecError(code: string): void;
  onSpeaking(busy: boolean): void;
  onReply(e: ReplyEvent): void;
}

export function createVoiceChat(d: VoiceDeps): VoiceChat {
  let phase: VoicePhase = 'off';
  let noSpeech = 0; // consecutive listening sessions in which nothing was heard
  let heard = false; // this listening session produced some (partial) text
  let replyDone = false; // the reply to the last thing she heard has ended (done / error)
  const timers: { pause: (() => void) | null; think: (() => void) | null } = { pause: null, think: null };
  const cancel = (k: keyof typeof timers) => { timers[k]?.(); timers[k] = null; };
  const cancelAll = () => { cancel('pause'); cancel('think'); };
  const setPhase = (p: VoicePhase) => {
    if (p === phase) return;
    phase = p;
    d.onPhase(p);
  };
  const awaitingReply = () => phase === 'thinking' || phase === 'speaking';

  function startThinkTimer() {
    cancel('think');
    timers.think = d.schedule(() => {
      timers.think = null;
      // no reply in time (the chat call failed silently): go back to listening instead of waiting forever
      if (phase === 'thinking') { replyDone = true; maybeListen(); }
    }, VOICE_TIMING.thinkMax);
  }

  function listenNow() {
    cancelAll();
    heard = false;
    setPhase('listening');
    d.startRec();
  }

  /** the reply has ended and she is not speaking: listen again after a short pause */
  function maybeListen() {
    if (!awaitingReply() || !replyDone || d.isSpeaking() || timers.pause) return;
    timers.pause = d.schedule(() => {
      timers.pause = null;
      if (awaitingReply() && replyDone && !d.isSpeaking()) listenNow();
    }, VOICE_TIMING.pause);
  }

  function stop() {
    if (phase === 'off') return;
    cancelAll();
    setPhase('off');
    d.stopRec();
    d.stopSpeech();
  }

  function start() {
    if (phase !== 'off') return;
    if (!d.supported) { d.note(VOICE_UNSUPPORTED_TEXT); return; }
    noSpeech = 0;
    replyDone = false;
    d.note('');
    listenNow();
  }

  function bargeIn() {
    if (phase === 'off') return;
    noSpeech = 0;
    listenNow(); // the phase changes first: the speech stop below then finds us listening
    d.stopSpeech();
  }

  const api: VoiceChat = {
    phase: () => phase,
    start,
    stop,
    toggle() {
      if (phase === 'off') start();
      else if (phase === 'speaking') bargeIn();
      else stop();
    },
    bargeIn,

    onRecPartial(text) {
      if (phase === 'listening' && text.trim()) heard = true;
    },

    onRecFinal(text) {
      if (phase !== 'listening') return;
      const t = text.trim();
      if (!t) return;
      noSpeech = 0;
      heard = false;
      replyDone = false;
      setPhase('thinking');
      startThinkTimer();
      void Promise.resolve(d.send(t)).catch(() => api.onReply({ type: 'error', id: 0, message: 'send failed' }));
    },

    onRecEnd(gotFinal) {
      if (phase !== 'listening' || gotFinal) return;
      // consecutive silent sessions: a session in which something was heard breaks the run
      if (heard) noSpeech = 0;
      else noSpeech++;
      heard = false;
      if (noSpeech >= NO_SPEECH_LIMIT) {
        d.note(VOICE_NO_SPEECH_TEXT);
        stop();
        return;
      }
      cancel('pause');
      timers.pause = d.schedule(() => {
        timers.pause = null;
        if (phase === 'listening') d.startRec();
      }, VOICE_TIMING.pause);
    },

    onRecError(code) {
      if (phase === 'off' || code === 'aborted' || code === 'no-speech') return; // no-speech counts in onRecEnd
      if (code === 'no-start' || code === 'unsupported' || code === 'start-failed') {
        d.note(VOICE_UNSUPPORTED_TEXT);
      } else {
        d.note(speechErrorText(code) || '語音辨識已停止');
      }
      stop();
    },

    onSpeaking(busy) {
      if (phase === 'off') return;
      if (busy) {
        cancel('pause');
        if (phase === 'listening') {
          d.stopRec(); // never hear herself: the session's late final text is ignored (not listening any more)
          setPhase('speaking');
        } else if (phase === 'thinking') {
          setPhase('speaking');
        }
        return;
      }
      if (phase === 'speaking') {
        if (replyDone) maybeListen();
        else setPhase('thinking');
        return;
      }
      maybeListen();
    },

    onReply(e) {
      if (phase === 'off') return;
      if (e.type === 'start') { replyDone = false; return; }
      if (e.type === 'delta') return;
      replyDone = true; // done or error
      maybeListen();
    },
  };
  return api;
}
