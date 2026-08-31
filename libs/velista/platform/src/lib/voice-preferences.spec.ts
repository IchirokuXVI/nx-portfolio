import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';
import { StorageKeys } from './storage-keys';
import { VoicePreferences } from './voice-preferences';

/**
 * A store in front of `localStorage`, which is reached through `BrowserFacade` and
 * never directly (plan 0001, D2). The fake is a map, so a test can say what was
 * already stored and read back what was written.
 */
function fakeBrowser(stored: Record<string, string> = {}) {
  const storage = new Map(Object.entries(stored));

  return {
    storage,
    readStorage: (key: string) => storage.get(key) ?? null,
    writeStorage: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
}

function make(stored: Record<string, string> = {}) {
  const browser = fakeBrowser(stored);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      VoicePreferences,
      { provide: BrowserFacade, useValue: browser },
    ],
  });

  return { preferences: TestBed.inject(VoicePreferences), browser };
}

describe('VoicePreferences', () => {
  it('is off on both counts for somebody who has never opened settings', () => {
    // The plain recorder is the default: stop sends, the bin discards, and nothing
    // leaves on its own. Anything else surprises somebody who paused to think.
    const { preferences } = make();

    expect(preferences.sendOnSilence()).toBe(false);
    expect(preferences.keepListening()).toBe(false);
  });

  it('reads a stored choice at construction, not on first use', () => {
    // So the composer never renders one behaviour and switches a frame later.
    const { preferences } = make({
      [StorageKeys.voiceSendOnSilence]: 'on',
      [StorageKeys.voiceKeepListening]: 'on',
    });

    expect(preferences.sendOnSilence()).toBe(true);
    expect(preferences.keepListening()).toBe(true);
  });

  it('keeps the two independent', () => {
    // Neither implies the other, and all four combinations are usable products.
    const { preferences } = make({ [StorageKeys.voiceKeepListening]: 'on' });

    expect(preferences.sendOnSilence()).toBe(false);
    expect(preferences.keepListening()).toBe(true);
  });

  it('persists a change so the next visit keeps it', () => {
    const { preferences, browser } = make();

    preferences.setSendOnSilence(true);
    preferences.setKeepListening(true);

    expect(browser.storage.get(StorageKeys.voiceSendOnSilence)).toBe('on');
    expect(browser.storage.get(StorageKeys.voiceKeepListening)).toBe('on');
    expect(preferences.sendOnSilence()).toBe(true);
  });

  it('writes the off state rather than removing the key', () => {
    // An absent key and a stored "off" both read as off, but writing it means a
    // deliberate switch back reads the same as never having touched it.
    const { preferences, browser } = make({
      [StorageKeys.voiceSendOnSilence]: 'on',
    });

    preferences.setSendOnSilence(false);

    expect(browser.storage.get(StorageKeys.voiceSendOnSilence)).toBe('off');
    expect(preferences.sendOnSilence()).toBe(false);
  });

  it('falls back to off where nothing can be stored', () => {
    // A private window, a browser with site data blocked, or a server render. The
    // safe direction is the behaviour that never sends anything unasked.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        VoicePreferences,
        {
          provide: BrowserFacade,
          useValue: {
            readStorage: () => null,
            writeStorage: () => undefined,
          },
        },
      ],
    });

    const preferences = TestBed.inject(VoicePreferences);

    expect(preferences.sendOnSilence()).toBe(false);
    expect(() => preferences.setKeepListening(true)).not.toThrow();
  });
});
