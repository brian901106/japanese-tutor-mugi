// soundtouchjs (LGPL-2.1, https://github.com/cutterbl/SoundTouchJS) ships no types; this is the part the app uses.
declare module 'soundtouchjs' {
  /** interleaved-stereo FIFO: frames are two floats each */
  export class FifoSampleBuffer {
    readonly frameCount: number;
    putSamples(samples: Float32Array, position?: number, numFrames?: number): void;
    receiveSamples(output: Float32Array, numFrames?: number): void;
  }
  /** time-stretch (tempo) and pitch shift that are independent of each other */
  export class SoundTouch {
    /** tempo factor: 2 is twice as fast (half the length), 1 leaves the duration alone */
    tempo: number;
    /** pitch shift in semitones, without changing the duration */
    pitchSemitones: number;
    readonly inputBuffer: FifoSampleBuffer;
    readonly outputBuffer: FifoSampleBuffer;
    process(): void;
    clear(): void;
  }
}
