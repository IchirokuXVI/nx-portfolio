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

/**
 * One call, as the gateway receives it: the history, and the thing being answered.
 *
 * `message` is empty for a spoken turn, because there is nothing on this side to put
 * there — which is the whole difference between the two.
 */
interface Sent {
  readonly transcript: readonly AssistantTurn[];
  readonly message: string;
  readonly recording?: Blob;
}

/** A service double that records what it was sent and answers what it was told to. */
function fakeAssistant(
  answer: (message: string) => Promise<AssistantReply>,
  spoken: () => Promise<AssistantReply> = () => reply('Vale.')
): AssistantServiceI & { sent: Sent[] } {
  const sent: Sent[] = [];

  return {
    sent,
    ask: (transcript, message) => {
      sent.push({ transcript, message });
      return answer(message);
    },
    askAloud: (transcript, recording) => {
      sent.push({ transcript, message: '', recording });
      return spoken();
    },
  };
}

function reply(text: string): Promise<AssistantReply> {
  return Promise.resolve({ text, references: [] });
}

/** A recording the store will accept: inside the cap, in a container it knows. */
function recording(bytes = 64, type = 'audio/webm;codecs=opus'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
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

  /**
   * A spoken turn (backend `0041`, section 8.4).
   *
   * The one behaviour a typed turn does not have: **the client does not know the
   * words.** Everything here is about what the caller's own bubble says while it does
   * not know them, and about the fact that it never guesses.
   */
  describe('a spoken turn', () => {
    it('uploads the recording and sends no message with it', async () => {
      const service = fakeAssistant(
        () => reply('never'),
        () =>
          Promise.resolve({
            text: 'Added.',
            references: [],
            heard: 'add bread',
          })
      );
      const subject = store(service);

      const audio = recording();
      await subject.speak(audio);

      expect(service.sent[0].recording).toBe(audio);
      expect(service.sent[0].message).toBe('');
    });

    it('shows a placeholder while it is out, then what the service heard', async () => {
      let settle: ((value: AssistantReply) => void) | undefined;
      const service = fakeAssistant(
        () => reply('never'),
        () => new Promise<AssistantReply>((resolve) => (settle = resolve))
      );
      const subject = store(service);

      const turn = subject.speak(recording());

      // In flight: something was said and is being listened to, and the bubble
      // carries no text because nothing on this side knows any.
      expect(subject.entries()[0]).toMatchObject({
        speaker: 'caller',
        kind: 'spoken',
        text: '',
      });

      settle?.({ text: 'Added.', references: [], heard: 'add bread' });
      await turn;

      expect(subject.entries()[0]).toMatchObject({
        kind: 'said',
        text: 'add bread',
      });
    });

    it('keeps the placeholder when the reply carries no heard', async () => {
      // A service that sends none is not broken, and the panel has nothing to invent
      // the words from. A bubble showing a guess at what somebody said is worse than
      // one showing that the words are not known.
      const service = fakeAssistant(
        () => reply('never'),
        () => reply('Added.')
      );
      const subject = store(service);

      await subject.speak(recording());

      expect(subject.entries()[0]).toMatchObject({ kind: 'spoken', text: '' });
    });

    it('keeps the placeholder when the turn fails', async () => {
      const service = fakeAssistant(
        () => reply('never'),
        () => Promise.reject(new NetworkError('c-1', 'assistant.askAloud'))
      );
      const subject = store(service);

      await subject.speak(recording());

      // The caller's bubble stays in the column whatever went wrong: they did speak,
      // and it is still true that they did. It just never learned the words.
      expect(subject.entries()[0]).toMatchObject({ kind: 'spoken' });
      expect(subject.entries()[1]).toMatchObject({ kind: 'failed' });
    });

    it('leaves a turn whose words never arrived out of the next transcript', async () => {
      // Rule A2: the transcript is what somebody actually said. A placeholder in the
      // conversation the model reads would be the client putting words in a person's
      // mouth, which is exactly what a client held transcript must not do.
      const service = fakeAssistant(
        () => reply('Sure.'),
        () => reply('Added.')
      );
      const subject = store(service);

      await subject.speak(recording());
      await subject.say('and eggs');

      expect(service.sent[1].transcript.map((turn) => turn.text)).toEqual([
        'Added.',
      ]);
    });

    it('refuses a recording over the cap, in words, without uploading it', async () => {
      const service = fakeAssistant(() => reply('never'));
      const subject = store(service);

      await subject.speak(recording(3 * 1024 * 1024));

      expect(service.sent).toHaveLength(0);
      expect(subject.entries()).toHaveLength(1);
      expect(subject.entries()[0].kind).toBe('tooLong');
    });

    it('refuses a container the service cannot read, without uploading it', async () => {
      const service = fakeAssistant(() => reply('never'));
      const subject = store(service);

      await subject.speak(recording(64, 'audio/x-caf'));

      expect(service.sent).toHaveLength(0);
      expect(subject.entries()[0].kind).toBe('badFormat');
    });

    it('accepts the codec parameters a browser tacks on', async () => {
      // Chrome says `audio/webm;codecs=opus`. Matching the whole string rather than
      // the container would refuse the commonest browser's own output.
      const service = fakeAssistant(
        () => reply('never'),
        () => reply('Added.')
      );
      const subject = store(service);

      await subject.speak(recording(64, 'audio/webm;codecs=opus'));

      expect(service.sent).toHaveLength(1);
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

  describe('when this deployment has no model provider', () => {
    it('says so, and does not tell anybody to try again', async () => {
      // A 501, which backend plan 0026 documents as an expected state: an install
      // with no GEMINI_API_KEY boots, stays in the published document, and answers
      // this forever. Retrying is the one thing that cannot help.
      const subject = store(
        fakeAssistant(() =>
          Promise.reject(
            new GatewayError({
              code: 'not_configured',
              status: 501,
              correlationId: 'ref-501',
            })
          )
        )
      );

      await subject.say('Add milk');

      expect(last(subject).kind).toBe('unconfigured');
      // The composer comes back: nothing is counting down, and holding it would be
      // pretending a wait would fix it.
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
