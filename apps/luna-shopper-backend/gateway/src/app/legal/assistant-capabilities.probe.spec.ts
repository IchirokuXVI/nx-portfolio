import {
  AiTextProvider,
  ASSISTANT_PATTERNS,
  type AssistantCapabilities,
} from '@portfolio/luna-shopper/contracts';
import { Observable, of } from 'rxjs';
import { NatsClient } from '../messaging/nats-client';
import {
  AssistantCapabilitiesProbe,
  CAPABILITIES_TIMEOUT_MS,
} from './assistant-capabilities.probe';

/**
 * The probe's timeout over the real {@link NatsClient} (plan 0231, section 3
 * and section 10, decision 3). A question the assistant takes and never answers
 * is given up on after five seconds, and giving up unsubscribes from the reply,
 * so a poll every minute leaves nothing waiting behind it. The answer before it
 * is kept.
 */

const ANSWER: AssistantCapabilities = {
  answers: true,
  hears: false,
  textProvider: AiTextProvider.GOOGLE,
};

function build() {
  const replies: Array<'answer' | 'silence'> = [];
  const subscribed = { open: 0, closed: 0 };
  const proxy = {
    send: jest.fn((subject: string) => {
      if (subject !== ASSISTANT_PATTERNS.capabilities) {
        throw new Error(`nothing answers ${subject} here`);
      }
      if (replies.shift() === 'answer') {
        return of(ANSWER);
      }
      // Took the question, never answers.
      return new Observable<never>(() => {
        subscribed.open += 1;
        return () => {
          subscribed.closed += 1;
        };
      });
    }),
  };
  const probe = new AssistantCapabilitiesProbe(new NatsClient(proxy as never));
  return { probe, proxy, replies, subscribed };
}

describe('AssistantCapabilitiesProbe', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives up on a silent assistant, tears the question down and keeps the last answer', async () => {
    const { probe, replies, subscribed } = build();
    replies.push('answer', 'silence');
    await probe.refresh();
    expect(probe.current()).toEqual(ANSWER);

    const silent = probe.refresh();
    await jest.advanceTimersByTimeAsync(CAPABILITIES_TIMEOUT_MS);
    await silent;

    expect(subscribed).toEqual({ open: 1, closed: 1 });
    expect(probe.current()).toEqual(ANSWER);
  });

  it('asks again on the next poll, and leaves no question open across many', async () => {
    const { probe, proxy, replies, subscribed } = build();
    replies.push('silence', 'silence', 'silence', 'answer');

    for (let poll = 0; poll < 3; poll += 1) {
      const silent = probe.refresh();
      await jest.advanceTimersByTimeAsync(CAPABILITIES_TIMEOUT_MS);
      await silent;
    }
    expect(probe.current()).toBeNull();
    await probe.refresh();

    expect(proxy.send).toHaveBeenCalledTimes(4);
    expect(subscribed).toEqual({ open: 3, closed: 3 });
    expect(probe.current()).toEqual(ANSWER);
  });
});
