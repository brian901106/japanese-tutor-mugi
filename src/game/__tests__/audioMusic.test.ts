import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The background music loader (game/audio.ts loadMusic, reached through playMusic). A missing or unreadable track is
// silence, never an error: a 404, a 200 that is really index.html (dev server / SPA fallback), and bytes that do not
// decode all leave the music off without an unhandled rejection.

type Calls = { bufferSources: number; started: number };

function fakeAudioEnv(calls: Calls, decode: 'ok' | 'reject') {
  const param = () => ({ value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: param(), connect() {}, disconnect() {} });
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    addEventListener() {}
    createGain() { return node(); }
    createAnalyser() { return node(); }
    createBuffer() { return {}; }
    createBufferSource() {
      calls.bufferSources++;
      return {
        buffer: null as unknown,
        loop: false,
        onended: null as unknown,
        connect() {},
        disconnect() {},
        start() { calls.started++; },
        stop() {},
        addEventListener() {},
      };
    }
    decodeAudioData(_ab: ArrayBuffer, ok: (b: unknown) => void, err: (e: unknown) => void) {
      if (decode === 'ok') {
        ok({ duration: 1 });
        return Promise.resolve({ duration: 1 });
      }
      const e = new Error('Unable to decode audio data');
      err(e);
      return Promise.reject(e); // modern browsers return the rejected promise as well
    }
  }
  vi.stubGlobal('window', { AudioContext: FakeAudioContext, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('localStorage', undefined);
}

/** plays the music once with the given response and lets the loader settle */
async function playWith(response: () => Response, decode: 'ok' | 'reject' = 'ok') {
  const calls: Calls = { bufferSources: 0, started: 0 };
  fakeAudioEnv(calls, decode);
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  const audio = await import('../audio');
  audio.playMusic(0);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { calls, fetchMock };
}

const audioResponse = () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });

describe('background music file', () => {
  let debug: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    debug.mockRestore();
    vi.unstubAllGlobals();
  });

  it('a missing file (404) is silence: nothing plays and nothing is logged as an error', async () => {
    const { calls, fetchMock } = await playWith(() => new Response('nope', { status: 404 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls.started).toBe(0);
    expect(debug).toHaveBeenCalled();
  });

  it('a 200 that is index.html (SPA fallback) is silence and is never decoded', async () => {
    const { calls } = await playWith(() => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(calls.bufferSources).toBe(0);
    expect(calls.started).toBe(0);
  });

  it('a 200 with audio bytes that do not decode is silence, with no unhandled rejection', async () => {
    const { calls } = await playWith(audioResponse, 'reject');
    expect(calls.started).toBe(0);
    expect(debug).toHaveBeenCalledWith('[audio] no background music:', 'Unable to decode audio data');
  });

  it('a 200 audio file that decodes plays (looping on the music bus)', async () => {
    const { calls } = await playWith(audioResponse, 'ok');
    expect(calls.started).toBe(1);
    expect(debug).not.toHaveBeenCalled();
  });
});
