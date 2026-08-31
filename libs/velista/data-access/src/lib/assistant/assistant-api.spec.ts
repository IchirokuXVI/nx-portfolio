import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AssistantTurn } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { AssistantApi } from './assistant-api';

const ENDPOINT = 'https://gateway.test/v1/assistant';

/**
 * The wire shape backend `0039` actually shipped, which is not the one velista `0032`
 * was written against.
 *
 * Three differences and all three are load bearing: the new message is its **own
 * field** rather than the last entry of the transcript, a transcript entry is
 * `{ role, content }` in `USER` / `ASSISTANT` rather than `{ speaker, text }`, and the
 * answer's prose is `reply` rather than `text`. This suite exists because none of
 * those is visible in a type: the client sends `unknown` and reads `unknown`, so only
 * a test can say the two ends agree.
 */
describe('AssistantApi', () => {
  let api: AssistantApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideVelistaTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        ApiUrl,
        AssistantApi,
      ],
    });

    api = TestBed.inject(AssistantApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('the request', () => {
    it('sends the message beside the transcript, in the gateway words', async () => {
      const transcript: AssistantTurn[] = [
        { speaker: 'caller', text: 'Add milk' },
        { speaker: 'bot', text: 'Added.' },
      ];

      const turn = api.ask(transcript, 'And eggs?');
      const request = httpMock.expectOne(ENDPOINT);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        message: 'And eggs?',
        transcript: [
          { role: 'USER', content: 'Add milk' },
          { role: 'ASSISTANT', content: 'Added.' },
        ],
      });

      request.flush({ reply: 'Added.', link: null });
      await turn;
    });

    it('goes to the gateway base URL, so there is no second origin', async () => {
      // Plan 0032 section 6, and an exit criterion: the panel added no new origin and
      // no new environment value, which is what backend 0039 section 3 bought by
      // proxying the assistant through the gateway.
      const turn = api.ask([], 'hello');
      const request = httpMock.expectOne(ENDPOINT);

      request.flush({ reply: 'Hello.', link: null });
      await turn;
    });

    it('trims to the gateway outer caps rather than letting it answer 400', async () => {
      // A transcript one entry too long comes back a 400, and a 400 on a conversation
      // reads to the person as the assistant having broken rather than as a
      // conversation having got long. The visible cap already happened in the store.
      const long: AssistantTurn[] = Array.from({ length: 140 }, (_, i) => ({
        speaker: i % 2 === 0 ? ('caller' as const) : ('bot' as const),
        text: 'x'.repeat(5000),
      }));

      const turn = api.ask(long, 'y'.repeat(3000));
      const request = httpMock.expectOne(ENDPOINT);
      const body = request.request.body as {
        message: string;
        transcript: { content: string }[];
      };

      expect(body.transcript).toHaveLength(100);
      expect(body.transcript[0].content).toHaveLength(4000);
      expect(body.message).toHaveLength(2000);

      request.flush({ reply: 'ok', link: null });
      await turn;
    });
  });

  /**
   * The spoken turn (backend `0041`, section 4.1).
   *
   * A separate route and a separate body shape, and neither is visible in a type
   * either: `FormData` takes anything, so only a test can say the parts are the ones
   * the gateway's interceptor and DTO are looking for.
   */
  describe('a spoken turn', () => {
    const recording = () => new Blob(['audio'], { type: 'audio/webm' });

    it('posts the recording and the transcript as multipart', async () => {
      const transcript: AssistantTurn[] = [
        { speaker: 'caller', text: 'Add milk' },
        { speaker: 'bot', text: 'Added.' },
      ];

      const turn = api.askAloud(transcript, recording());
      const request = httpMock.expectOne(`${ENDPOINT}/voice`);
      const body = request.request.body as FormData;

      expect(request.request.method).toBe('POST');
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('audio')).toBeInstanceOf(Blob);
      // The same words the typed route uses, from the same builder: two routes that
      // disagreed about what a transcript is would be a bug waiting for whichever was
      // edited second.
      expect(JSON.parse(body.get('transcript') as string)).toEqual([
        { role: 'USER', content: 'Add milk' },
        { role: 'ASSISTANT', content: 'Added.' },
      ]);

      request.flush({ reply: 'Added.', link: null, heard: 'and eggs' });
      await turn;
    });

    it('writes no Content-Type of its own', async () => {
      // The assertion with something to lose. The browser has to write the boundary
      // itself, and a hand written `multipart/form-data` header omits it and produces
      // a body the server cannot split — which fails as a 400 with nothing obviously
      // wrong in the request.
      const turn = api.askAloud([], recording());
      const request = httpMock.expectOne(`${ENDPOINT}/voice`);

      expect(request.request.headers.get('Content-Type')).toBeNull();

      request.flush({ reply: 'Vale.', link: null });
      await turn;
    });

    it('reads back what the service heard', async () => {
      const turn = api.askAloud([], recording());
      httpMock
        .expectOne(`${ENDPOINT}/voice`)
        .flush({ reply: 'Added.', link: null, heard: 'add milk' });

      await expect(turn).resolves.toMatchObject({
        text: 'Added.',
        heard: 'add milk',
      });
    });

    it('carries an empty transcription rather than dropping it', async () => {
      // Empty is a real answer: the recording had nothing recognisable in it. It is
      // not the same as absent, which means the service said nothing about what it
      // heard, so the two must not collapse into one.
      const turn = api.askAloud([], recording());
      httpMock
        .expectOne(`${ENDPOINT}/voice`)
        .flush({ reply: 'I did not catch that.', link: null, heard: '' });

      await expect(turn).resolves.toMatchObject({ heard: '' });
    });

    it('leaves heard absent when the service sent none', async () => {
      const turn = api.askAloud([], recording());
      httpMock
        .expectOne(`${ENDPOINT}/voice`)
        .flush({ reply: 'Added.', link: null });

      await expect(turn).resolves.not.toHaveProperty('heard');
    });
  });

  /**
   * A recording spoken into a list's own composer (velista `0038`, and `0042`
   * section 5).
   *
   * The defect this locks down was reported as the list page's microphone asking which
   * list on a screen showing one list, and the fix for it is on the server: a scoped
   * turn narrows the tool catalog and not the tool descriptions. This is the half of
   * the contract this app owns, and it is one assertion because that is all it takes:
   * a request that leaves this app either carries the scope or does not exist.
   */
  describe('a turn scoped to a list', () => {
    it('posts zoneId and listId beside the recording', async () => {
      const turn = api.askAboutList(
        'zone-flat',
        'list-weekly',
        new Blob(['audio'], { type: 'audio/webm' })
      );

      const request = httpMock.expectOne(`${ENDPOINT}/voice`);
      const body = request.request.body as FormData;

      expect(body.get('zoneId')).toBe('zone-flat');
      expect(body.get('listId')).toBe('list-weekly');
      expect(body.get('audio')).toBeInstanceOf(Blob);

      request.flush({ reply: 'Added.', link: null });
      await turn;
    });
  });

  describe('the answer', () => {
    it('reads reply, the one link, and the answers under a question', async () => {
      const turn = api.ask([], 'Is there milk?');

      httpMock.expectOne(ENDPOINT).flush({
        reply: 'Yes.',
        listResolution: 'ONLY_LIST',
        link: {
          zoneId: 'z1',
          listId: 'l1',
          label: 'Weekly',
          zoneLabel: 'Flat',
        },
        choices: [],
      });

      await expect(turn).resolves.toEqual({
        text: 'Yes.',
        listResolution: 'onlyList',
        link: {
          zoneId: 'z1',
          listId: 'l1',
          label: 'Weekly',
          zoneLabel: 'Flat',
        },
        choices: [],
      });
    });

    it('drops a link whose ids do not address a list (rule A3)', async () => {
      // `listId` is nullable on the wire. A link without one cannot be turned into a
      // URL, and inventing one would produce exactly the 404 that rule A3 exists to
      // prevent, so the link is not drawn at all.
      const turn = api.ask([], 'Where?');

      httpMock.expectOne(ENDPOINT).flush({
        reply: 'There.',
        link: { zoneId: 'z1', listId: null, label: 'X', zoneLabel: null },
      });

      await expect(turn).resolves.toEqual({
        text: 'There.',
        link: null,
        choices: [],
      });
    });

    it('carries no listResolution when the turn was not a write', async () => {
      const turn = api.ask([], 'hello');

      httpMock.expectOne(ENDPOINT).flush({ reply: 'Hello.', link: null });

      await expect(turn).resolves.toEqual({
        text: 'Hello.',
        link: null,
        choices: [],
      });
    });

    it('rejects a body it cannot read rather than rendering an empty bubble', async () => {
      // An empty bubble is not an honest rendering of a reply that did not arrive, so
      // this reaches the page's failure branch, where the copy is right.
      const turn = api.ask([], 'hello');

      httpMock.expectOne(ENDPOINT).flush({ text: 'wrong field name' });

      await expect(turn).rejects.toThrow('assistant.ask');
    });
  });
});
