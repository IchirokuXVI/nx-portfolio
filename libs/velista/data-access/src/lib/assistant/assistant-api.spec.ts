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

      request.flush({ reply: 'Added.', references: [] });
      await turn;
    });

    it('goes to the gateway base URL, so there is no second origin', async () => {
      // Plan 0032 section 6, and an exit criterion: the panel added no new origin and
      // no new environment value, which is what backend 0039 section 3 bought by
      // proxying the assistant through the gateway.
      const turn = api.ask([], 'hello');
      const request = httpMock.expectOne(ENDPOINT);

      request.flush({ reply: 'Hello.', references: [] });
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

      request.flush({ reply: 'ok', references: [] });
      await turn;
    });
  });

  describe('the answer', () => {
    it('reads reply, and the uppercase reference kinds', async () => {
      const turn = api.ask([], 'Is there milk?');

      httpMock.expectOne(ENDPOINT).flush({
        reply: 'Yes.',
        listResolution: 'ONLY_LIST',
        references: [
          {
            kind: 'ZONE',
            zoneId: 'z1',
            listId: null,
            lineId: null,
            label: 'Flat',
          },
          {
            kind: 'LIST',
            zoneId: 'z1',
            listId: 'l1',
            lineId: null,
            label: 'Weekly',
          },
          {
            kind: 'LINE',
            zoneId: 'z1',
            listId: 'l1',
            lineId: 'ln1',
            label: 'Milk',
          },
        ],
      });

      await expect(turn).resolves.toEqual({
        text: 'Yes.',
        listResolution: 'onlyList',
        references: [
          { kind: 'zone', zoneId: 'z1', label: 'Flat' },
          { kind: 'list', zoneId: 'z1', listId: 'l1', label: 'Weekly' },
          {
            kind: 'line',
            zoneId: 'z1',
            listId: 'l1',
            lineId: 'ln1',
            label: 'Milk',
          },
        ],
      });
    });

    it('drops a reference whose ids do not address anything (rule A3)', async () => {
      // `listId` and `lineId` are nullable on the wire. A LINE with a null listId
      // cannot be turned into a URL, and inventing one would produce exactly the 404
      // that rule A3 exists to prevent, so the link is not drawn at all.
      const turn = api.ask([], 'Where?');

      httpMock.expectOne(ENDPOINT).flush({
        reply: 'There.',
        references: [
          {
            kind: 'LINE',
            zoneId: 'z1',
            listId: null,
            lineId: 'ln1',
            label: 'Milk',
          },
          {
            kind: 'LIST',
            zoneId: 'z1',
            listId: null,
            lineId: null,
            label: 'X',
          },
          { kind: 'ELEPHANT', zoneId: 'z1', listId: 'l1', label: 'X' },
          {
            kind: 'ZONE',
            zoneId: 'z1',
            listId: null,
            lineId: null,
            label: 'Flat',
          },
        ],
      });

      await expect(turn).resolves.toEqual({
        text: 'There.',
        references: [{ kind: 'zone', zoneId: 'z1', label: 'Flat' }],
      });
    });

    it('carries no listResolution when the turn was not a write', async () => {
      const turn = api.ask([], 'hello');

      httpMock.expectOne(ENDPOINT).flush({ reply: 'Hello.', references: [] });

      await expect(turn).resolves.toEqual({ text: 'Hello.', references: [] });
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
