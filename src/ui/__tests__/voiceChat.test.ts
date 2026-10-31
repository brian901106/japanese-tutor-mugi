import { beforeEach, describe, expect, it } from 'vitest';
import { createVoiceChat, NO_SPEECH_LIMIT, VOICE_NO_SPEECH_TEXT, VOICE_TIMING, VOICE_UNSUPPORTED_TEXT, type VoiceChat, type VoiceDeps, type VoicePhase } from '../voiceChat';

// fakes: a manual clock for the timers, and recorders for every effect the machine asks for
function setup(over: Partial<VoiceDeps> = {}) {
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  let now = 0;
  const log = {
    phases: [] as VoicePhase[],
    startRec: 0, stopRec: 0, stopSpeech: 0,
    sent: [] as string[],
    notes: [] as string[],
  };
  const speech = { busy: false };
  const d: VoiceDeps = {
    supported: true,
    startRec: () => { log.startRec++; },
    stopRec: () => { log.stopRec++; },
    isSpeaking: () => speech.busy,
    stopSpeech: () => { log.stopSpeech++; },
    send: (t) => { log.sent.push(t); },
    note: (t) => { log.notes.push(t); },
    onPhase: (p) => { log.phases.push(p); },
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    ...over,
  };
  const chat: VoiceChat = createVoiceChat(d);
  /** advance the clock, running due timers in order */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.live = false;
      due.fn();
    }
    now = end;
  };
  const pending = () => timers.filter((t) => t.live).length;
  return { chat, log, speech, advance, pending, reset: () => { timers = []; } };
}

/** the phase sequence the machine went through, without repeats */
const phasesOf = (log: { phases: VoicePhase[] }) => log.phases;

describe('voice chat state machine', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); });

  it('start listens: recognition starts', () => {
    h.chat.start();
    expect(h.chat.phase()).toBe('listening');
    expect(h.log.startRec).toBe(1);
  });

  it('without speech recognition it does not start and says so (TTS is untouched)', () => {
    h = setup({ supported: false });
    h.chat.start();
    expect(h.chat.phase()).toBe('off');
    expect(h.log.notes).toEqual([VOICE_UNSUPPORTED_TEXT]);
    expect(h.log.startRec).toBe(0);
  });

  it('a final transcript is sent once and moves to thinking', () => {
    h.chat.start();
    h.chat.onRecFinal('  今天天氣如何  ');
    expect(h.log.sent).toEqual(['今天天氣如何']);
    expect(h.chat.phase()).toBe('thinking');
  });

  it('full loop: listen → think → she speaks (mic stays off) → done → listen again after the pause', () => {
    h.chat.start();
    h.chat.onRecFinal('嗨');
    h.chat.onReply({ type: 'start', id: 1 });
    h.speech.busy = true;
    h.chat.onSpeaking(true);
    expect(h.chat.phase()).toBe('speaking');
    expect(h.log.stopRec).toBe(0); // thinking → speaking: nothing was listening
    h.chat.onReply({ type: 'done', id: 1, text: '嗨！' });
    expect(h.chat.phase()).toBe('speaking');
    h.speech.busy = false;
    h.chat.onSpeaking(false);
    expect(h.chat.phase()).toBe('speaking'); // the pause has not run yet
    h.advance(VOICE_TIMING.pause - 1);
    expect(h.chat.phase()).toBe('speaking');
    h.advance(1);
    expect(h.chat.phase()).toBe('listening');
    expect(h.log.startRec).toBe(2);
    expect(phasesOf(h.log)).toEqual(['listening', 'thinking', 'speaking', 'listening']);
  });

  it('never listens while she speaks: a session that was listening stops its mic when her speech starts', () => {
    h.chat.start();
    h.chat.onReply({ type: 'start', id: 2 }); // e.g. a tap reaction while the loop listens
    h.speech.busy = true;
    h.chat.onSpeaking(true);
    expect(h.chat.phase()).toBe('speaking');
    expect(h.log.stopRec).toBe(1);
    // her late final text from the stopped session is ignored
    h.chat.onRecFinal('聽到了');
    expect(h.log.sent).toEqual([]);
  });

  it('does not go back to listening while the reply is still streaming', () => {
    h.chat.start();
    h.chat.onRecFinal('問題');
    h.speech.busy = true;
    h.chat.onSpeaking(true);
    h.speech.busy = false;
    h.chat.onSpeaking(false); // a sentence ended, the next one not queued yet
    expect(h.chat.phase()).toBe('thinking');
    h.advance(VOICE_TIMING.pause * 2);
    expect(h.chat.phase()).toBe('thinking');
    h.chat.onReply({ type: 'done', id: 3, text: '' });
    h.advance(VOICE_TIMING.pause);
    expect(h.chat.phase()).toBe('listening');
  });

  it('the reply is done and nothing is spoken (voice off): listens again after the pause', () => {
    h.chat.start();
    h.chat.onRecFinal('好');
    h.chat.onReply({ type: 'start', id: 4 });
    h.chat.onReply({ type: 'done', id: 4, text: '好' });
    expect(h.chat.phase()).toBe('thinking');
    h.advance(VOICE_TIMING.pause);
    expect(h.chat.phase()).toBe('listening');
  });

  it('a reply that errors also ends the wait', () => {
    h.chat.start();
    h.chat.onRecFinal('好');
    h.chat.onReply({ type: 'error', id: 5, message: 'boom' });
    h.advance(VOICE_TIMING.pause);
    expect(h.chat.phase()).toBe('listening');
  });

  it('a failing send ends the wait too', async () => {
    h = setup({ send: () => Promise.reject(new Error('net')) });
    h.chat.start();
    h.chat.onRecFinal('好');
    await new Promise((r) => setTimeout(r, 0));
    h.advance(VOICE_TIMING.pause);
    expect(h.chat.phase()).toBe('listening');
  });

  it('no reply at all: after the think timeout it listens again', () => {
    h.chat.start();
    h.chat.onRecFinal('好');
    h.advance(VOICE_TIMING.thinkMax - 1);
    expect(h.chat.phase()).toBe('thinking');
    h.advance(1 + VOICE_TIMING.pause);
    expect(h.chat.phase()).toBe('listening');
  });

  it('barge-in: a tap while she speaks stops her and listens', () => {
    h.chat.start();
    h.chat.onRecFinal('說長一點');
    h.speech.busy = true;
    h.chat.onSpeaking(true);
    h.chat.toggle();
    expect(h.chat.phase()).toBe('listening');
    expect(h.log.stopSpeech).toBe(1);
    expect(h.log.startRec).toBe(2); // start, then the barge-in
    // the speech queue reports idle when it is stopped: still listening
    h.speech.busy = false;
    h.chat.onSpeaking(false);
    expect(h.chat.phase()).toBe('listening');
  });

  it('a tap while listening stops the whole loop (mic and speech)', () => {
    h.chat.start();
    h.chat.toggle();
    expect(h.chat.phase()).toBe('off');
    expect(h.log.stopRec).toBe(1);
    expect(h.log.stopSpeech).toBe(1);
  });

  it('a tap while thinking also stops the loop', () => {
    h.chat.start();
    h.chat.onRecFinal('好');
    h.chat.toggle();
    expect(h.chat.phase()).toBe('off');
  });

  it('a tap while off starts the loop', () => {
    h.chat.toggle();
    expect(h.chat.phase()).toBe('listening');
  });

  it('two silent listening sessions in a row stop the loop with the hint', () => {
    h.chat.start();
    for (let i = 0; i < NO_SPEECH_LIMIT - 1; i++) {
      h.chat.onRecError('no-speech');
      h.chat.onRecEnd(false);
      h.advance(VOICE_TIMING.pause);
      expect(h.chat.phase()).toBe('listening');
    }
    h.chat.onRecError('no-speech');
    h.chat.onRecEnd(false);
    expect(h.chat.phase()).toBe('off');
    expect(h.log.notes).toContain(VOICE_NO_SPEECH_TEXT);
  });

  it('a session with speech heard breaks the run of silent sessions', () => {
    h.chat.start();
    h.chat.onRecEnd(false); // silent #1
    h.advance(VOICE_TIMING.pause);
    h.chat.onRecPartial('嗯');
    h.chat.onRecEnd(false); // heard, no final: the run restarts
    h.advance(VOICE_TIMING.pause);
    h.chat.onRecEnd(false); // silent #1 again
    expect(h.chat.phase()).toBe('listening');
    h.advance(VOICE_TIMING.pause);
    h.chat.onRecEnd(false); // silent #2 in a row
    expect(h.chat.phase()).toBe('off');
  });

  it('a final text clears the silence count', () => {
    h.chat.start();
    h.chat.onRecEnd(false); // silent #1
    h.advance(VOICE_TIMING.pause);
    h.chat.onRecFinal('你好');
    h.chat.onReply({ type: 'done', id: 6, text: '' });
    h.advance(VOICE_TIMING.pause);
    h.chat.onRecEnd(false); // silent #1 again (count restarted)
    expect(h.chat.phase()).toBe('listening');
  });

  it('a silent session restarts the recognition after the pause', () => {
    h.chat.start();
    h.chat.onRecEnd(false);
    expect(h.log.startRec).toBe(1);
    h.advance(VOICE_TIMING.pause);
    expect(h.log.startRec).toBe(2);
    expect(h.chat.phase()).toBe('listening');
  });

  it('a recognition error other than silence stops the loop with a note', () => {
    h.chat.start();
    h.chat.onRecError('not-allowed');
    expect(h.chat.phase()).toBe('off');
    expect(h.log.notes.at(-1)).toBe('需要允許麥克風權限');
  });

  it('a recognition that cannot start is the unsupported case', () => {
    h.chat.start();
    h.chat.onRecError('no-start');
    expect(h.chat.phase()).toBe('off');
    expect(h.log.notes.at(-1)).toBe(VOICE_UNSUPPORTED_TEXT);
  });

  it('aborted sessions are ignored', () => {
    h.chat.start();
    h.chat.onRecError('aborted');
    expect(h.chat.phase()).toBe('listening');
  });

  it('events after stop change nothing', () => {
    h.chat.start();
    h.chat.onRecFinal('好');
    h.chat.stop();
    h.chat.onReply({ type: 'done', id: 7, text: '好' });
    h.chat.onSpeaking(false);
    h.chat.onRecEnd(false);
    expect(h.chat.phase()).toBe('off');
    expect(h.log.startRec).toBe(1);
  });
});
