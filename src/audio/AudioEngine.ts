import type { EngineModule } from '@/core';
import { Vec3 } from '@/core/math';

/**
 * Internal handle for an active synthesized voice so it can be cleaned up on
 * completion (stop + disconnect) to avoid leaking Web Audio nodes.
 */
interface Voice {
  /** Source nodes to stop (oscillators / buffer sources). */
  sources: AudioScheduledSourceNode[];
  /** Every node created for this voice, disconnected on teardown. */
  nodes: AudioNode[];
}

/**
 * Spatial procedural audio engine. Everything is synthesized with the Web Audio
 * API — there are NO audio assets. The {@link AudioContext} is created lazily and
 * stays suspended until {@link AudioEngine.resume} is called from a user gesture.
 *
 * Implements {@link EngineModule} so it can be registered with the engine. All
 * public methods are guarded so they never throw when audio is unavailable or
 * the context has not yet been resumed.
 */
export class AudioEngine implements EngineModule {
  readonly name = 'audio';

  /** The lazily-created Web Audio context (null until first needed / unsupported). */
  private ctx: AudioContext | null = null;
  /** Master gain node feeding the destination. */
  private master: GainNode | null = null;
  /** True once a user gesture has resumed the context. */
  private started = false;
  /** Backing store for the masterGain accessor (applied to {@link master} when present). */
  private _masterGain = 1;
  /** Cached, shared noise buffer (regenerated lazily per context). */
  private noiseBuffer: AudioBuffer | null = null;
  /** Active voices, cleaned up as they end. */
  private readonly voices = new Set<Voice>();
  /** True once disposed; further calls are ignored. */
  private disposed = false;

  constructor() {
    // Context creation is deferred to resume() / first use so construction is
    // side-effect free and safe in non-browser / SSR environments.
  }

  /**
   * Master output volume in the range 0..1. Setting this updates the live master
   * gain node immediately (if a context exists); the value is cached otherwise.
   */
  get masterGain(): number {
    return this._masterGain;
  }
  set masterGain(v: number) {
    const g = clamp01(v);
    this._masterGain = g;
    if (this.master && this.ctx) {
      try {
        this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
      } catch {
        // Some implementations may reject scheduling; fall back to direct set.
        try {
          this.master.gain.value = g;
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Resume (or create) the audio context. MUST be called from a user gesture
   * handler the first time, otherwise browsers keep the context suspended.
   * Safe to call repeatedly.
   */
  resume(): void {
    if (this.disposed) return;
    if (!this.ensureContext()) return;
    this.started = true;
    const ctx = this.ctx;
    if (ctx && ctx.state === 'suspended') {
      // resume() returns a promise; swallow rejections so we never throw.
      void ctx.resume().catch(() => {
        /* ignore — staying suspended is acceptable */
      });
    }
  }

  /**
   * Update the listener's spatial pose. Uses the modern AudioParam interface
   * (positionX/forwardX/...) when available, falling back to the deprecated
   * setPosition/setOrientation otherwise. Vectors are not retained.
   */
  setListener(pos: Vec3, forward: Vec3, up: Vec3): void {
    if (this.disposed) return;
    if (!this.ensureContext()) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const listener = ctx.listener;
    const t = ctx.currentTime;

    // Normalize the orientation vectors defensively.
    const f = normalized(forward.x, forward.y, forward.z, 0, 0, -1);
    const u = normalized(up.x, up.y, up.z, 0, 1, 0);

    try {
      if (listener.positionX) {
        listener.positionX.setValueAtTime(pos.x, t);
        listener.positionY.setValueAtTime(pos.y, t);
        listener.positionZ.setValueAtTime(pos.z, t);
        listener.forwardX.setValueAtTime(f[0], t);
        listener.forwardY.setValueAtTime(f[1], t);
        listener.forwardZ.setValueAtTime(f[2], t);
        listener.upX.setValueAtTime(u[0], t);
        listener.upY.setValueAtTime(u[1], t);
        listener.upZ.setValueAtTime(u[2], t);
      } else {
        // Deprecated API (older Safari/Firefox).
        const anyListener = listener as unknown as {
          setPosition?: (x: number, y: number, z: number) => void;
          setOrientation?: (
            fx: number,
            fy: number,
            fz: number,
            ux: number,
            uy: number,
            uz: number,
          ) => void;
        };
        anyListener.setPosition?.(pos.x, pos.y, pos.z);
        anyListener.setOrientation?.(f[0], f[1], f[2], u[0], u[1], u[2]);
      }
    } catch {
      /* ignore — listener pose is non-critical */
    }
  }

  /**
   * Play a procedurally-synthesized tone: an oscillator through a short ADSR-ish
   * gain envelope (to avoid clicks), optionally spatialized via an HRTF panner.
   *
   * @param freq Frequency in Hz.
   * @param durationSec Sustain duration in seconds (envelope adds small fades).
   * @param opts Optional waveform type, peak gain, and world position.
   */
  playTone(
    freq: number,
    durationSec: number,
    opts?: { type?: OscillatorType; gain?: number; pos?: Vec3 },
  ): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const dur = Math.max(0.005, durationSec);
    const peak = clamp01(opts?.gain ?? 0.3);

    try {
      const osc = ctx.createOscillator();
      osc.type = opts?.type ?? 'sine';
      osc.frequency.setValueAtTime(Math.max(1, freq), now);

      const env = ctx.createGain();
      // ADSR-ish: quick attack, short decay to sustain, release tail.
      const attack = Math.min(0.01, dur * 0.2);
      const release = Math.min(0.08, dur * 0.5);
      const sustainLevel = peak * 0.8;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
      env.gain.linearRampToValueAtTime(Math.max(0.0001, sustainLevel), now + attack + 0.02);
      // Hold sustain until release starts.
      const releaseStart = Math.max(now + attack + 0.02, now + dur - release);
      env.gain.setValueAtTime(Math.max(0.0001, sustainLevel), releaseStart);
      env.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);

      osc.connect(env);
      const out = this.spatialize(env, opts?.pos);

      const stopAt = releaseStart + release + 0.02;
      this.registerVoice([osc], [osc, env, ...out.extra]);
      osc.start(now);
      osc.stop(stopAt);
    } catch {
      /* ignore — never throw from a one-shot */
    }
  }

  /**
   * Synthesize a short percussive impact (collision thud/click): a low sine
   * "body" with a fast pitch drop plus a filtered noise burst. Strength scales
   * both gain and pitch. Spatialized if a position is given.
   *
   * @param strength Impact magnitude (>=0); clamped internally.
   * @param pos Optional world position for spatialization.
   */
  playImpact(strength: number, pos?: Vec3): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const s = Math.min(1, Math.max(0, strength));
    const gain = 0.15 + s * 0.6;
    // Higher strength -> higher pitched, snappier thud.
    const baseFreq = 90 + s * 160;

    try {
      // ---- Body: low sine with a fast downward pitch sweep ----
      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(baseFreq, now);
      body.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq * 0.35), now + 0.12);

      const bodyEnv = ctx.createGain();
      bodyEnv.gain.setValueAtTime(Math.max(0.0002, gain), now);
      bodyEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      body.connect(bodyEnv);

      // ---- Click/transient: filtered noise burst ----
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer();
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(800 + s * 3000, now);
      noiseFilter.Q.value = 0.7;
      const noiseEnv = ctx.createGain();
      noiseEnv.gain.setValueAtTime(Math.max(0.0002, gain * 0.7), now);
      noiseEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseEnv);

      // ---- Mix both branches into a common node, then spatialize ----
      const mix = ctx.createGain();
      bodyEnv.connect(mix);
      noiseEnv.connect(mix);
      const out = this.spatialize(mix, pos);

      this.registerVoice(
        [body, noise],
        [body, bodyEnv, noise, noiseFilter, noiseEnv, mix, ...out.extra],
      );
      body.start(now);
      body.stop(now + 0.16);
      noise.start(now);
      noise.stop(now + 0.07);
    } catch {
      /* ignore */
    }
  }

  /**
   * Synthesize a whoosh: a noise burst pushed through a band-pass filter whose
   * center frequency sweeps up then down, with a soft volume swell. Spatialized
   * if a position is given.
   *
   * @param pos Optional world position for spatialization.
   */
  playWhoosh(pos?: Vec3): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const dur = 0.45;

    try {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer();
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      // Sweep the band up then back down for a "passing by" feel.
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(2400, now + dur * 0.5);
      filter.frequency.exponentialRampToValueAtTime(400, now + dur);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.35, now + dur * 0.4);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      noise.connect(filter);
      filter.connect(env);
      const out = this.spatialize(env, pos);

      this.registerVoice([noise], [noise, filter, env, ...out.extra]);
      noise.start(now);
      noise.stop(now + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  /** Per-frame update. Listener smoothing is handled in setListener; no-op here. */
  update(_dt: number): void {
    // Intentionally a no-op: voices self-clean via their `ended` handlers and the
    // listener is updated explicitly. Kept to satisfy the EngineModule contract.
  }

  /**
   * Stop and disconnect every active voice, then close the audio context and
   * release all references. Safe to call multiple times.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Tear down any voices still playing.
    for (const voice of Array.from(this.voices)) {
      this.teardownVoice(voice);
    }
    this.voices.clear();

    if (this.master) {
      try {
        this.master.disconnect();
      } catch {
        /* ignore */
      }
      this.master = null;
    }

    const ctx = this.ctx;
    if (ctx) {
      try {
        if (ctx.state !== 'closed') {
          void ctx.close().catch(() => {
            /* ignore */
          });
        }
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.noiseBuffer = null;
    this.started = false;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Lazily create the AudioContext + master gain chain. Returns false if Web
   * Audio is unavailable (or creation failed) so callers can bail gracefully.
   */
  private ensureContext(): boolean {
    if (this.disposed) return false;
    if (this.ctx) return true;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this._masterGain;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return true;
    } catch {
      this.ctx = null;
      this.master = null;
      return false;
    }
  }

  /** True when we can actually schedule sound right now. */
  private canPlay(): boolean {
    if (this.disposed) return false;
    // Before resume(), queued plays are ignored gracefully (no context churn).
    if (!this.started) {
      // Still create nothing; honor the "ignored until resume()" contract.
      // We attempt a lazy ensure only after resume() flips `started`.
      return false;
    }
    if (!this.ensureContext()) return false;
    return this.ctx !== null && this.master !== null && this.ctx.state !== 'closed';
  }

  /**
   * Optionally route a node through an HRTF panner positioned in world space,
   * then into the master bus. Returns the extra nodes created so the caller can
   * include them in the voice for teardown.
   */
  private spatialize(
    input: AudioNode,
    pos?: Vec3,
  ): { extra: AudioNode[] } {
    const ctx = this.ctx!;
    const master = this.master!;
    const extra: AudioNode[] = [];
    if (pos) {
      try {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 10000;
        panner.rolloffFactor = 1;
        const t = ctx.currentTime;
        if (panner.positionX) {
          panner.positionX.setValueAtTime(pos.x, t);
          panner.positionY.setValueAtTime(pos.y, t);
          panner.positionZ.setValueAtTime(pos.z, t);
        } else {
          (panner as unknown as {
            setPosition?: (x: number, y: number, z: number) => void;
          }).setPosition?.(pos.x, pos.y, pos.z);
        }
        input.connect(panner);
        panner.connect(master);
        extra.push(panner);
        return { extra };
      } catch {
        // Fall through to non-spatial routing on any failure.
      }
    }
    input.connect(master);
    return { extra };
  }

  /** Lazily build (and cache) a 1-second buffer of white noise for this context. */
  private getNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.max(1, Math.floor(ctx.sampleRate)); // ~1s of noise
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * Register a voice and wire up automatic cleanup: when the (longest) source
   * ends, all of its nodes are stopped and disconnected.
   */
  private registerVoice(sources: AudioScheduledSourceNode[], nodes: AudioNode[]): void {
    const voice: Voice = { sources, nodes };
    this.voices.add(voice);
    let remaining = sources.length;
    const onEnded = (): void => {
      remaining--;
      if (remaining <= 0) {
        this.teardownVoice(voice);
        this.voices.delete(voice);
      }
    };
    for (const src of sources) {
      try {
        src.addEventListener('ended', onEnded, { once: true });
      } catch {
        // If we cannot listen for end, decrement so cleanup still triggers.
        remaining--;
      }
    }
    if (remaining <= 0) {
      // No reliable end events; clean up defensively on next macrotask.
      this.teardownVoice(voice);
      this.voices.delete(voice);
    }
  }

  /** Stop and disconnect all nodes of a voice. Idempotent and never throws. */
  private teardownVoice(voice: Voice): void {
    for (const src of voice.sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Free helpers (module-private)
// ---------------------------------------------------------------------------

/** Clamp a value into the 0..1 range. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Resolve the AudioContext constructor across browsers (incl. webkit prefix),
 * or null when Web Audio is unavailable (e.g. SSR / unsupported environments).
 */
function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Return a normalized [x,y,z]; if the input is degenerate (near-zero length),
 * fall back to the provided default direction.
 */
function normalized(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return [dx, dy, dz];
  return [x / len, y / len, z / len];
}
