import { WebAudioNotificationTone } from './notification-tone';

/**
 * Nothing here makes a sound, and jsdom has no `AudioContext` at all, so the first
 * case is the one that runs by default and is the one that matters most: a device
 * with no audio API must not turn a delivered recording into a failed one.
 */
describe('WebAudioNotificationTone', () => {
  const realCtor = (globalThis as { AudioContext?: unknown }).AudioContext;

  afterEach(() => {
    if (realCtor === undefined) {
      delete (globalThis as { AudioContext?: unknown }).AudioContext;
    } else {
      (globalThis as { AudioContext?: unknown }).AudioContext = realCtor;
    }
  });

  it('does nothing where there is no audio API', () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;

    expect(() => new WebAudioNotificationTone().play()).not.toThrow();
  });

  it('plays a short tone through a gain envelope', () => {
    const oscillator = {
      type: '',
      frequency: { setValueAtTime: jest.fn() },
      connect: jest.fn(),
      disconnect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      onended: null as (() => void) | null,
    };
    const gain = {
      gain: {
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: jest.fn(),
      createOscillator: () => oscillator,
      createGain: () => gain,
    };
    const ctor = jest.fn(() => context);
    (globalThis as { AudioContext?: unknown }).AudioContext = ctor;

    const tone = new WebAudioNotificationTone();
    tone.play();

    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
    // Up and then down: a tone rather than a click at one end and a cut at the other.
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledTimes(2);

    // One context for many blips. A browser allows only a handful per document and
    // collects them lazily, so a context per sound runs out after a few dozen.
    tone.play();
    expect(ctor).toHaveBeenCalledTimes(1);

    // The nodes are what is built per play, and they let go of the graph when the
    // sound ends rather than accumulating one per recording.
    oscillator.onended?.();
    expect(oscillator.disconnect).toHaveBeenCalled();
    expect(gain.disconnect).toHaveBeenCalled();
  });

  it('asks a suspended context to resume, and survives a refusal', () => {
    // Autoplay policy. In practice a press on the microphone precedes this, but the
    // policy differs between browsers and a silent notification is indistinguishable
    // from a broken one.
    const context = {
      state: 'suspended',
      currentTime: 0,
      destination: {},
      resume: jest.fn().mockRejectedValue(new Error('not allowed')),
      createOscillator: () => ({
        type: '',
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null,
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
        disconnect: jest.fn(),
      }),
    };
    (globalThis as { AudioContext?: unknown }).AudioContext = jest.fn(
      () => context
    );

    expect(() => new WebAudioNotificationTone().play()).not.toThrow();
    expect(context.resume).toHaveBeenCalled();
  });

  it('stays quiet rather than throwing when a node cannot be built', () => {
    // The recording has already been sent by the time this runs. Nothing that happens
    // in here is worth more than the thing it is announcing.
    (globalThis as { AudioContext?: unknown }).AudioContext = jest.fn(() => ({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: jest.fn(),
      createOscillator: () => {
        throw new Error('no oscillator');
      },
      createGain: jest.fn(),
    }));

    expect(() => new WebAudioNotificationTone().play()).not.toThrow();
  });
});
