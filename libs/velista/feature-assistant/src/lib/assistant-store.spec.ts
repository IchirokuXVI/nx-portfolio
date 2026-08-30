import { TestBed } from '@angular/core/testing';
import {
  ASSISTANT_SERVICE,
  GatewayError,
  NetworkError,
  type AssistantServiceI,
} from '@portfolio/velista/data-access';
import {
  ASSISTANT_MAX_CHARS,
  ASSISTANT_MAX_TURNS,
  type AssistantReply,
  type AssistantTurn,
} from '@portfolio/velista/models';
import { AssistantStore, capTranscript } from './assistant-store';

/** One call, as the gateway receives it: the history, and the thing being answered. */
interface Sent {
  readonly transcript: readonly AssistantTurn[];
  readonly message: string;
}

/** A service double that records what it was sent and answers what it was told to. */
function fakeAssistant(
  answer: (message: string) => Promise<AssistantReply>
): AssistantServiceI & { sent: Sent[] } {
  const sent: Sent[] = [];

  return {
    sent,
    ask: (transcript, message) => {
      sent.push({ transcript, message });
      return answer(message);
    },
  };
}

function reply(text: string): Promise<AssistantReply> {
  return Promise.resolve({ text, references: [] });
}

function store(service: AssistantServiceI): AssistantStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      AssistantStore,
      { provide: ASSISTANT_SERVICE, useValue: service },
    ],
  });

  return TestBed.inject(AssistantStore);
}

describe('AssistantStore', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('a turn', () => {
    it('keeps what was said and what came back, in order', async () => {
      const subject = store(fakeAssistant(() => reply('Added.')));

      await subject.say('Add milk');

      expect(
        subject.entries().map((entry) => [entry.speaker, entry.text])
      ).toEqual([
        ['caller', 'Add milk'],
        ['bot', 'Added.'],
      ]);
    });

    it('sends the whole conversation, because the service keeps none of it', async () => {
      // Backend rule A2. There is no conversation id and nothing to resume, so the
      // second turn carries the first one with it.
      const service = fakeAssistant(() => reply('Yes.'));
      const subject = store(service);

      await subject.say('Add milk');
      await subject.say('And eggs?');

      expect(service.sent[1]).toEqual({
        transcript: [
          { speaker: 'caller', text: 'Add milk' },
          { speaker: 'bot', text: 'Yes.' },
        ],
        message: 'And eggs?',
      });
    });

    it('keeps the new message out of the history of the question', async () => {
      // The gateway takes `message` as its own field and `transcript` as what came
      // before, so the thing being answered must not also appear in the conversation
      // it is being answered against. The first turn therefore sends an empty history.
      const service = fakeAssistant(() => reply('Added.'));
      const subject = store(service);

      await subject.say('Add milk');

      expect(service.sent[0]).toEqual({ transcript: [], message: 'Add milk' });
    });

    it('holds the composer while a turn is out and releases it after', async () => {
      let release: ((value: AssistantReply) => void) | undefined;
      const subject = store(
        fakeAssistant(
          () => new Promise<AssistantReply>((resolve) => (release = resolve))
        )
      );

      const turn = subject.say('Add milk');
      expect(subject.composerDisabled()).toBe(true);

      release?.({ text: 'Added.', references: [] });
      await turn;

      expect(subject.composerDisabled()).toBe(false);
    });
  });

  describe('a spoken turn', () => {
    it('is the same call as a typed one, because it arrives as words', async () => {
      // Backend 0039 shipped no audio route, so the browser transcribes and there is
      // one endpoint and one method. The caller's bubble is what was actually heard,
      // which under an audio upload would have needed the service to send it back.
      const service = fakeAssistant(() => reply('Added.'));
      const subject = store(service);

      await subject.say('add bread to the weekly shop');

      expect(service.sent[0].message).toBe('add bread to the weekly shop');
      expect(subject.entries()[0].text).toBe('add bread to the weekly shop');
    });
  });

  describe('when a turn fails', () => {
    it('puts the failure in the transcript and re-enables the composer', async () => {
      // A message, not a banner: one kind of thing, in one place, whatever went wrong.
      const subject = store(
        fakeAssistant(() =>
          Promise.reject(new NetworkError('ref-1', 'assistant.ask'))
        )
      );

      await subject.say('Add milk');

      expect(subject.entries().map((entry) => entry.kind)).toEqual([
        'said',
        'failed',
      ]);
      expect(subject.composerDisabled()).toBe(false);
    });

    it('keeps the caller message, so nothing has to be typed again', async () => {
      const subject = store(
        fakeAssistant(() =>
          Promise.reject(new NetworkError('ref-1', 'assistant.ask'))
        )
      );

      await subject.say('Add milk');

      expect(subject.entries()[0].text).toBe('Add milk');
    });

    it('never sends a failed turn back to the service', async () => {
      // A failure is the app talking about itself and carries no meaning for a model.
      let fail = true;
      const service = fakeAssistant(() =>
        fail
          ? Promise.reject(new NetworkError('ref-1', 'assistant.ask'))
          : reply('Added.')
      );
      const subject = store(service);

      await subject.say('Add milk');
      fail = false;
      await subject.say('Again');

      expect(service.sent[1]).toEqual({
        transcript: [{ speaker: 'caller', text: 'Add milk' }],
        message: 'Again',
      });
    });
  });

  describe('when the provider is busy', () => {
    it('counts the server down and re-enables the composer at zero', async () => {
      // Rule A5. The free tier's limits are shared across every user of this app, so
      // being asked to wait is ordinary, and the honest answer to it is a number that
      // visibly shrinks rather than "try again later".
      jest.useFakeTimers();
      const subject = store(fakeAssistant(() => Promise.reject(throttled(3))));

      await subject.say('Add tomatoes');

      expect(last(subject).kind).toBe('throttled');
      expect(last(subject).retryAfterSeconds).toBe(3);
      expect(subject.composerDisabled()).toBe(true);

      jest.advanceTimersByTime(1000);
      expect(last(subject).retryAfterSeconds).toBe(2);
      expect(subject.composerDisabled()).toBe(true);

      jest.advanceTimersByTime(2000);
      expect(subject.composerDisabled()).toBe(false);
      expect(last(subject).retryAfterSeconds).toBeUndefined();
    });

    it('invents no number when the server named none', async () => {
      // The countdown is a display of a value the server sent. Absent means it did not
      // say, which is not the same as zero and is not something to guess at.
      const subject = store(
        fakeAssistant(() => Promise.reject(throttled(undefined)))
      );

      await subject.say('Add tomatoes');

      expect(last(subject).kind).toBe('throttled');
      expect(last(subject).retryAfterSeconds).toBeUndefined();
      // Nothing to count, so nothing is held: the person may try again whenever they
      // like, which is the only honest offer without a number.
      expect(subject.composerDisabled()).toBe(false);
    });
  });

  describe('the cap', () => {
    it('drops the oldest turns and says so', async () => {
      const subject = store(fakeAssistant(() => reply('ok')));

      for (let turn = 0; turn < ASSISTANT_MAX_TURNS; turn += 1) {
        await subject.say(`turn ${turn}`);
      }

      const entries = subject.entries();
      expect(entries[0].kind).toBe('dropped');
      expect(entries.filter((entry) => entry.kind === 'said').length).toBe(
        ASSISTANT_MAX_TURNS
      );
      // The very first thing said is gone, which is the point of the notice.
      expect(entries.some((entry) => entry.text === 'turn 0')).toBe(false);
    });

    it('caps what it sends as well as what it keeps', async () => {
      const service = fakeAssistant(() => reply('ok'));
      const subject = store(service);

      for (let turn = 0; turn < ASSISTANT_MAX_TURNS; turn += 1) {
        await subject.say(`turn ${turn}`);
      }

      const sent = service.sent[service.sent.length - 1];
      expect(sent.transcript.length).toBeLessThanOrEqual(ASSISTANT_MAX_TURNS);
    });
  });

  describe('capTranscript', () => {
    it('drops from the front, never from the end', () => {
      const turns = Array.from({ length: ASSISTANT_MAX_TURNS + 3 }, (_, i) => ({
        text: `t${i}`,
      }));

      const kept = capTranscript(turns);

      expect(kept).toHaveLength(ASSISTANT_MAX_TURNS);
      expect(kept[kept.length - 1]).toBe(turns[turns.length - 1]);
    });

    it('also enforces the character budget, which bites first on long turns', () => {
      // Two caps because the server enforces two: a short conversation about long
      // lists overruns the characters long before it reaches twenty turns.
      const long = 'x'.repeat(ASSISTANT_MAX_CHARS);
      const kept = capTranscript([{ text: long }, { text: long }]);

      expect(kept).toHaveLength(1);
    });
  });
});

function throttled(retryAfterSeconds: number | undefined): GatewayError {
  return new GatewayError({
    code: 'rate_limited',
    status: 429,
    correlationId: 'ref-429',
    retryAfterSeconds,
  });
}

function last(subject: AssistantStore) {
  const entries = subject.entries();
  return entries[entries.length - 1];
}
