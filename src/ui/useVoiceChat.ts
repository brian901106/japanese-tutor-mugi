import { useCallback, useEffect, useRef, useState } from 'react';
import { onReply } from '../game/replyBus';
import { onSpeaking, speakingNow, stopSpeaking, unlockSpeech } from '../game/tts';
import { createVoiceChat, type VoiceChat, type VoicePhase } from './voiceChat';
import { speechCtor, useSpeechInput } from './useSpeechInput';

export type { VoicePhase } from './voiceChat';

/**
 * 語音對話: the hands-free loop (listen → think → speak → listen). The state lives in ui/voiceChat (pure); this hook
 * connects it to the speech recognition (useSpeechInput), the speech queue (game/tts) and the reply bus.
 */
export function useVoiceChat(opts: {
  /** the same send as the typed chat; may return a promise (a failure ends the wait for the reply) */
  send: (text: string) => void | Promise<void>;
  /** the recognizer language (useSpeechInput), read at each listening turn; default zh-TW */
  lang?: string;
}) {
  const [phase, setPhase] = useState<VoicePhase>('off');
  const [note, setNote] = useState('');
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const recRef = useRef<{ start(): void; stop(): void } | null>(null);
  const chatRef = useRef<VoiceChat | null>(null);

  const rec = useSpeechInput({
    onPartial: (t) => chatRef.current?.onRecPartial(t),
    onFinal: (t) => chatRef.current?.onRecFinal(t),
    onEnd: (gotFinal) => chatRef.current?.onRecEnd(gotFinal),
    onError: (code) => chatRef.current?.onRecError(code),
  }, { lang: opts.lang });
  recRef.current = rec;

  if (!chatRef.current) {
    chatRef.current = createVoiceChat({
      supported: speechCtor() !== null,
      startRec: () => recRef.current?.start(),
      stopRec: () => recRef.current?.stop(),
      isSpeaking: speakingNow,
      stopSpeech: stopSpeaking,
      send: (t) => optsRef.current.send(t),
      note: setNote,
      onPhase: setPhase,
      schedule: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
    });
  }

  useEffect(() => onSpeaking((b) => chatRef.current?.onSpeaking(b)), []);
  useEffect(() => onReply((e) => chatRef.current?.onReply(e)), []);
  // leaving the chat ends the loop (its own speech and mic with it)
  useEffect(() => () => chatRef.current?.stop(), []);

  /** the voice button: a tap is a user gesture, so it also unlocks speech for iOS */
  const toggle = useCallback(() => {
    unlockSpeech();
    chatRef.current?.toggle();
  }, []);
  const stop = useCallback(() => chatRef.current?.stop(), []);

  return {
    phase,
    active: phase !== 'off',
    note,
    supported: rec.supported,
    toggle,
    stop,
  };
}
