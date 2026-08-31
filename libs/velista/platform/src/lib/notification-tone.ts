import { InjectionToken } from '@angular/core';

/**
 * A short sound, played when something left the device.
 *
 * An interface behind a token rather than a class injected directly, for the reason
 * `SILENCE_DETECTOR` has one: the real implementation reaches the Web Audio API, and a
 * spec that wants to know whether a sound was played should be able to answer that
 * without a browser and without hearing anything.
 */
export interface NotificationToneI {
  /**
   * Play it.
   *
   * **Never throws and never rejects.** It is called from the middle of a send, and a
   * missing audio API, a browser that refuses to start a context, or a device with no
   * output must not turn a delivered recording into a failed one. Nothing that happens
   * in here is worth more than the thing it is announcing.
   */
  play(): void;
}

/**
 * How loud, as a linear gain.
 *
 * Quiet on purpose. This plays while somebody is still speaking into the microphone
 * that is still open, so it has to be audible over a kitchen and forgettable at the
 * same time. Loud enough to notice, quiet enough that hearing it twenty times while
 * dictating a shopping list is not a punishment.
 */
const PEAK_GAIN = 0.06;

/**
 * The pitch, in hertz.
 *
 * High enough to cut through room noise and to sit well clear of speech, which is
 * mostly under 500Hz for the fundamentals: a tone buried in the voice band is one the
 * person mistakes for their own recording playing back.
 */
const FREQUENCY_HZ = 880;

/** How long the whole blip lasts, in seconds. Two frames of a phone's refresh. */
const DURATION_S = 0.12;

/**
 * How long the attack takes, in seconds.
 *
 * Not zero. A gain that jumps from silence to full is a click, which is a different
 * sound from a tone and a worse one on a small speaker.
 */
const ATTACK_S = 0.012;

/**
 * The real one: an oscillator through a gain envelope, built per play.
 *
 * ## Nothing at construction
 *
 * Rule D2. The context is created on the first {@link play} and never before, so this
 * is safe to hold in a server rendered injector and safe to resolve in jsdom, where
 * there is no `AudioContext` at all and every call is a no-op.
 *
 * ## One context, many blips
 *
 * A browser allows a small number of audio contexts per document and never collects
 * them promptly, so a context per sound runs out after a few dozen. The nodes are what
 * is built per play; they are cheap and they disconnect themselves when the oscillator
 * ends.
 *
 * ## Why it may be suspended
 *
 * Autoplay policy: a context created without a user gesture starts suspended and stays
 * silent. In practice the first sound here follows a press on the microphone, so the
 * gesture has happened, but the resume is asked for anyway because the policy differs
 * between browsers and a silent notification is indistinguishable from a broken one.
 */
export class WebAudioNotificationTone implements NotificationToneI {
  private _context: AudioContext | null = null;

  play(): void {
    try {
      const context = this._open();
      if (context === null) {
        return;
      }

      // Suspended is the autoplay policy, and resuming is a promise that rejects when
      // the browser will not have it. Nothing to do about that but stay quiet.
      if (context.state === 'suspended') {
        void context.resume().catch(() => undefined);
      }

      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(FREQUENCY_HZ, now);

      // An exponential release rather than a linear one, because loudness is
      // logarithmic: a linear ramp to zero is heard as a sound that stops abruptly
      // near the end. It cannot reach zero, hence the small floor.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + ATTACK_S);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION_S);

      oscillator.connect(gain);
      gain.connect(context.destination);

      // Disconnected when it ends, so a long session does not accumulate a node per
      // recording on the context's graph.
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };

      oscillator.start(now);
      oscillator.stop(now + DURATION_S);
    } catch {
      // A context the browser refused to build, a node type it does not have, or an
      // output that disappeared. All of them mean the same thing here: no sound.
    }
  }

  /** The context, built on first use, or null where there is no audio API. */
  private _open(): AudioContext | null {
    if (this._context !== null) {
      return this._context;
    }

    // Read off the global rather than referenced directly, so this file compiles and
    // runs where `AudioContext` is not declared: the server, and jsdom.
    const ctor = (
      globalThis as {
        AudioContext?: new () => AudioContext;
        webkitAudioContext?: new () => AudioContext;
      }
    ).AudioContext;

    if (ctor === undefined) {
      return null;
    }

    this._context = new ctor();

    return this._context;
  }
}

export const NOTIFICATION_TONE = new InjectionToken<NotificationToneI>(
  'NOTIFICATION_TONE',
  {
    providedIn: 'root',
    factory: () => new WebAudioNotificationTone(),
  }
);
