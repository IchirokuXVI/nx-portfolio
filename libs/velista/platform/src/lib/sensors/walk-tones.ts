import { InjectionToken } from '@angular/core';

/**
 * The two sounds of a walk (velista `0126`, target 9): one when the walk stops
 * because of the camera, and one when tracking came back by itself. Made with Web
 * Audio, with no audio file, behind a token for `NOTIFICATION_TONE`'s reason: a
 * spec asks whether a sound played without hearing it.
 */
export interface WalkTonesI {
  /** The walk stopped: two falling notes. Never throws. */
  stopped(): void;
  /** Tracking came back by itself: two rising notes. Never throws. */
  resumed(): void;
}

/**
 * Louder than the notification tone, on purpose: it has to be heard in a
 * supermarket, with the phone held at arm's length.
 */
const PEAK_GAIN = 0.18;

/** Each note, in seconds. */
const NOTE_S = 0.16;

/** The gap between the two notes, in seconds. */
const GAP_S = 0.05;

/** The attack, in seconds: never zero, or the note starts with a click. */
const ATTACK_S = 0.015;

/** A fourth apart, so the two sounds are told apart by direction alone. */
const HIGH_HZ = 880;
const LOW_HZ = 660;

/**
 * The real tones: two oscillator notes through a gain envelope each, on one
 * context built on the first play, like `WebAudioNotificationTone`.
 */
export class WebAudioWalkTones implements WalkTonesI {
  private _context: AudioContext | null = null;

  stopped(): void {
    this._play([HIGH_HZ, LOW_HZ]);
  }

  resumed(): void {
    this._play([LOW_HZ, HIGH_HZ]);
  }

  private _play(notes: readonly number[]): void {
    try {
      const context = this._open();
      if (context === null) {
        return;
      }
      if (context.state === 'suspended') {
        void context.resume().catch(() => undefined);
      }
      notes.forEach((hz, index) => {
        const at = context.currentTime + index * (NOTE_S + GAP_S);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(hz, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + ATTACK_S);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(at);
        oscillator.stop(at + NOTE_S);
      });
    } catch {
      // No audio API, or an output that went away: no sound.
    }
  }

  private _open(): AudioContext | null {
    if (this._context !== null) {
      return this._context;
    }
    const ctor = (globalThis as { AudioContext?: new () => AudioContext })
      .AudioContext;
    if (ctor === undefined) {
      return null;
    }
    this._context = new ctor();
    return this._context;
  }
}

export const WALK_TONES = new InjectionToken<WalkTonesI>('WALK_TONES', {
  providedIn: 'root',
  factory: () => new WebAudioWalkTones(),
});
