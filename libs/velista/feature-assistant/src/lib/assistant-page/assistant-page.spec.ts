import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ASSISTANT_SERVICE,
  GatewayError,
  type AssistantServiceI,
} from '@portfolio/velista/data-access';
import type { AssistantReference } from '@portfolio/velista/models';
import {
  SPEECH_CAPTURE,
  provideVelistaTesting,
  type SpeechCaptureI,
} from '@portfolio/velista/platform';
import { AssistantPage } from './assistant-page';

/** A microphone that is simply not there. These tests are about the transcript. */
const NO_MICROPHONE: SpeechCaptureI = {
  supported: () => false,
  open: () => Promise.reject(new Error('no microphone in this test')),
};

interface Options {
  /** What the service answers, or throws. */
  readonly answer?: () => Promise<{
    text: string;
    references: readonly AssistantReference[];
  }>;
  /** `/velista` mounted in the portfolio shell, `''` on velista's own origin. */
  readonly basePath?: string;
}

async function render(
  options: Options = {}
): Promise<ComponentFixture<AssistantPage>> {
  TestBed.resetTestingModule();

  const service: AssistantServiceI = {
    ask: () => (options.answer ?? emptyAnswer)(),
  };

  await TestBed.configureTestingModule({
    imports: [AssistantPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '/velista' }),
      provideRouter([]),
      { provide: ASSISTANT_SERVICE, useValue: service },
      { provide: SPEECH_CAPTURE, useValue: NO_MICROPHONE },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AssistantPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function emptyAnswer() {
  return Promise.resolve({ text: 'ok', references: [] });
}

function host(fixture: ComponentFixture<AssistantPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

async function say(
  fixture: ComponentFixture<AssistantPage>,
  text: string
): Promise<void> {
  await fixture.componentInstance.send(text);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function links(fixture: ComponentFixture<AssistantPage>): HTMLAnchorElement[] {
  return Array.from(host(fixture).querySelectorAll('a.link'));
}

const REFERENCES: readonly AssistantReference[] = [
  { kind: 'zone', zoneId: 'z1', label: 'Flat 3B' },
  { kind: 'list', zoneId: 'z1', listId: 'l1', label: 'Weekly shop' },
  {
    kind: 'line',
    zoneId: 'z1',
    listId: 'l1',
    lineId: 'ln1',
    label: 'Milk · 2 l',
  },
];

describe('AssistantPage', () => {
  describe('the empty state', () => {
    it('says what the bot can do, in three lines, before anybody types', async () => {
      // A text box with a cursor in it tells nobody what to type, and the three lines
      // are the three tools (plan 0032, section 3).
      const fixture = await render();

      expect(host(fixture).querySelectorAll('.example')).toHaveLength(3);
      expect(host(fixture).querySelector('lib-assistant-message')).toBeNull();
    });
  });

  describe('the links under a reply', () => {
    it('draws one per reference, with the mounted paths', async () => {
      const fixture = await render({
        answer: () => Promise.resolve({ text: 'Yes.', references: REFERENCES }),
      });

      await say(fixture, 'Is there milk?');

      expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
        '/velista/en/zones/z1',
        '/velista/en/zones/z1/lists/l1',
        '/velista/en/zones/z1/lists/l1?line=ln1',
      ]);
    });

    it('draws the same links correctly on velista own origin', async () => {
      // The reason every path is built with `appPath` rather than assembled: a
      // hardcoded one is wrong in exactly one of the two run modes, and it is the mode
      // nobody looks at (section 7).
      const fixture = await render({
        basePath: '',
        answer: () => Promise.resolve({ text: 'Yes.', references: REFERENCES }),
      });

      await say(fixture, 'Is there milk?');

      expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
        '/en/zones/z1',
        '/en/zones/z1/lists/l1',
        '/en/zones/z1/lists/l1?line=ln1',
      ]);
    });

    it('sends a line to the list with a query parameter, never to a sheet', async () => {
      // All three of the list page's line sheets **do** something to a line and none of
      // them simply shows one, so a link in a chat message must not open one
      // (section 8).
      const fixture = await render({
        basePath: '',
        answer: () =>
          Promise.resolve({ text: 'Added.', references: [REFERENCES[2]] }),
      });

      await say(fixture, 'Add milk');

      const href = links(fixture)[0].getAttribute('href');
      expect(href).toBe('/en/zones/z1/lists/l1?line=ln1');
      expect(href).not.toContain('/edit');
      expect(href).not.toContain('/comments');
      expect(href).not.toContain('/confirm');
    });

    it('renders link-shaped prose as text and draws nothing from it', async () => {
      // The reply is never parsed for ids and never rendered as markdown. An id in a
      // sentence has none of the properties an id in `references` has, and a link to a
      // list that was never there is worse than no link at all.
      const fixture = await render({
        answer: () =>
          Promise.resolve({
            text: 'It is on https://example.test/zones/z9 and [here](/velista/en/zones/z9).',
            references: [],
          }),
      });

      await say(fixture, 'Where is it?');

      expect(links(fixture)).toHaveLength(0);
      expect(host(fixture).querySelectorAll('a')).toHaveLength(0);
      expect(host(fixture).textContent).toContain(
        '[here](/velista/en/zones/z9)'
      );
    });
  });

  describe('when something goes wrong', () => {
    it('says so in the transcript rather than over it', async () => {
      const fixture = await render({
        answer: () => Promise.reject(new Error('the network went away')),
      });

      await say(fixture, 'Add milk');

      const messages = host(fixture).querySelectorAll('lib-assistant-message');
      expect(messages).toHaveLength(2);
      expect(messages[1].textContent).toContain('assistant.failed');
    });

    it('counts the server seconds down beside the message', async () => {
      const fixture = await render({
        answer: () =>
          Promise.reject(
            new GatewayError({
              code: 'rate_limited',
              status: 429,
              correlationId: 'ref-429',
              retryAfterSeconds: 18,
            })
          ),
      });

      await say(fixture, 'Add tomatoes');

      expect(host(fixture).querySelector('.count')?.textContent).toBe('18');
      expect(host(fixture).textContent).toContain('assistant.busy.body');
    });

    it('shows no clock at all when the server named no number', async () => {
      const fixture = await render({
        answer: () =>
          Promise.reject(
            new GatewayError({
              code: 'rate_limited',
              status: 429,
              correlationId: 'ref-429',
            })
          ),
      });

      await say(fixture, 'Add tomatoes');

      expect(host(fixture).querySelector('.count')).toBeNull();
      expect(host(fixture).textContent).toContain('assistant.busy.noNumber');
    });
  });
});
