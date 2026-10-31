// Client-side speed and pitch for cloud voice clips. The server always synthesizes at rate 1 / pitch 1 (so its cache
// key does not change with the sliders); the 語速 and 音調 settings are applied here to the decoded clip with SoundTouch
// (tempo and pitch are independent, so the length follows the speed and the pitch does not change it).
import { SoundTouch } from 'soundtouchjs';

export type VoiceFx = { speed: number; semitones: number };

/** the 音調 slider to semitones, the same mapping the server used for Google (server/tts.ts googlePitch): 0.05 per semitone */
export const pitchToSemitones = (pitch: number): number => Math.round((pitch - 1) * 20 * 10) / 10;

/** the effect a cloud sentence asks for: its 語速 is the speed, its 音調 the semitones */
export const voiceFxFor = (rate: number, pitch: number): VoiceFx => ({ speed: rate, semitones: pitchToSemitones(pitch) });

export const isNeutralFx = (fx: VoiceFx): boolean => fx.speed === 1 && fx.semitones === 0;

/** silence appended to the input so the last window of speech is flushed out of SoundTouch's buffers */
const FLUSH_SECONDS = 0.25;
const CHUNK_FRAMES = 4096;

/** one channel, mono in and out: the output is input.length / speed samples long */
export function shiftChannel(input: Float32Array, sampleRate: number, fx: VoiceFx): Float32Array {
  const outLen = Math.round(input.length / fx.speed);
  const out = new Float32Array(outLen);
  const st = new SoundTouch();
  st.tempo = fx.speed;
  st.pitchSemitones = fx.semitones;
  let written = 0;
  const drain = () => {
    while (st.outputBuffer.frameCount > 0) {
      const n = st.outputBuffer.frameCount;
      const tmp = new Float32Array(n * 2);
      st.outputBuffer.receiveSamples(tmp, n);
      for (let i = 0; i < n && written < outLen; i++) out[written++] = tmp[2 * i];
    }
  };
  // SoundTouch takes interleaved stereo; a mono clip is fed to both sides and the left one is kept
  const total = input.length + Math.round(sampleRate * FLUSH_SECONDS);
  const chunk = new Float32Array(CHUNK_FRAMES * 2);
  for (let pos = 0; pos < total; pos += CHUNK_FRAMES) {
    const n = Math.min(CHUNK_FRAMES, total - pos);
    for (let i = 0; i < n; i++) {
      const s = pos + i < input.length ? input[pos + i] : 0;
      chunk[2 * i] = s;
      chunk[2 * i + 1] = s;
    }
    st.inputBuffer.putSamples(chunk, 0, n);
    st.process();
    drain();
  }
  return out;
}

/** every channel of a clip; a neutral effect returns the input channels untouched */
export function applyVoiceFx(channels: Float32Array[], sampleRate: number, fx: VoiceFx): Float32Array[] {
  if (isNeutralFx(fx) || channels.length === 0 || channels[0].length === 0) return channels;
  return channels.map((c) => shiftChannel(c, sampleRate, fx));
}

/** a decoded clip with the effect applied; created with the given context, the input buffer is never changed */
export function applyVoiceFxToBuffer(buf: AudioBuffer, fx: VoiceFx, ctx: Pick<BaseAudioContext, 'createBuffer'>): AudioBuffer {
  if (isNeutralFx(fx) || buf.numberOfChannels === 0 || buf.length === 0) return buf;
  const inputs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const outs = applyVoiceFx(inputs, buf.sampleRate, fx);
  const res = ctx.createBuffer(outs.length, outs[0].length, buf.sampleRate);
  outs.forEach((o, c) => res.copyToChannel(o as Float32Array<ArrayBuffer>, c));
  return res;
}
