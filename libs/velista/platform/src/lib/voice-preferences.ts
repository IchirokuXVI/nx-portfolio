import { inject, Injectable, signal, type Signal } from '@angular/core';
import { BrowserFacade } from './browser-facade';
import { StorageKeys } from './storage-keys';

/** What a stored flag looks like. Written by hand rather than via JSON, which would
 * turn a one character value into a parse that can fail. */
const ON = 'on';

/**
 * How the microphone behaves, as two independent choices.
 *
 * ## Why these are settings and not a design
 *
 * Plan 0038 shipped one behaviour: a silence ended the recording and sent it. It was
 * built for somebody at an open fridge with their hands full, and for that person it is
 * right. For everybody else it is a microphone that decides on its own when a sentence
 * is over, and pausing to think about the next item sends half a list. Making the
 * plain recorder the default and keeping the other behaviour behind a switch costs one
 * boolean and settles an argument that has no general answer, because the two people
 * are using the same screen for different things.
 *
 * ## The two are orthogonal, and they compose into four usable products
 *
 * | send on silence | keep listening | what it is |
 * | --- | --- | --- |
 * | off | off | a plain recorder: stop sends, trash discards. The default |
 * | on | off | it ends the recording when you stop talking, and sends that one |
 * | off | on | stop sends and the microphone stays open for the next one |
 * | on | on | hands free dictation: talk, pause, talk, and each pause is a line |
 *
 * Nothing here reads the other, so neither implies the other and there is no invalid
 * combination to guard against.
 *
 * ## Local, and not on the account
 *
 * `providedIn: 'root'` and `localStorage`, which is deliberate on both counts. This is
 * a property of the device and the room it is in rather than of the person: the phone
 * in a noisy kitchen and the laptop at a desk want different answers, and syncing the
 * choice to the account would make one of them wrong. It also depends on nothing the
 * app supplies, so unlike `ThemeStore` it does not need the app injector (rule D5).
 *
 * A browser that cannot store answers null through `BrowserFacade` and both flags fall
 * back to off, which is the safe direction: the default behaviour is the one that never
 * sends anything the person did not ask to send.
 */
@Injectable({ providedIn: 'root' })
export class VoicePreferences {
  /** Whether a silence ends the recording and sends it. */
  readonly sendOnSilence: Signal<boolean>;

  /** Whether the microphone reopens once a recording has been sent. */
  readonly keepListening: Signal<boolean>;

  private readonly _browser = inject(BrowserFacade);
  private readonly _sendOnSilence = signal(false);
  private readonly _keepListening = signal(false);

  constructor() {
    // Read at construction rather than on first use, so the composer never renders
    // one behaviour and then switches to the other a frame later.
    this._sendOnSilence.set(
      this._browser.readStorage(StorageKeys.voiceSendOnSilence) === ON
    );
    this._keepListening.set(
      this._browser.readStorage(StorageKeys.voiceKeepListening) === ON
    );

    this.sendOnSilence = this._sendOnSilence.asReadonly();
    this.keepListening = this._keepListening.asReadonly();
  }

  setSendOnSilence(on: boolean): void {
    this._sendOnSilence.set(on);
    this._write(StorageKeys.voiceSendOnSilence, on);
  }

  setKeepListening(on: boolean): void {
    this._keepListening.set(on);
    this._write(StorageKeys.voiceKeepListening, on);
  }

  /**
   * Fire and forget, exactly as `ThemeStore` writes a theme: the facade swallows a
   * storage failure, and a setting that did not persist is not worth failing a tap
   * over. The choice still holds for this session, which is the part that was asked
   * for.
   */
  private _write(key: string, on: boolean): void {
    this._browser.writeStorage(key, on ? ON : 'off');
  }
}
