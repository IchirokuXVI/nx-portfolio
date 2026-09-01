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
import type {
  AssistantChoice,
  AssistantListLink,
} from '@portfolio/velista/models';
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
  readonly answer?: (message: string) => Promise<{
    text: string;
    link: AssistantListLink | null;
    choices: readonly AssistantChoice[];
  }>;
  /** `/velista` mounted in the portfolio shell, `''` on velista's own origin. */
  readonly basePath?: string;
}

async function render(
  options: Options = {}
): Promise<ComponentFixture<AssistantPage>> {
  TestBed.resetTestingModule();

  const service: AssistantServiceI = {
    ask: (_transcript, message) => (options.answer ?? emptyAnswer)(message),
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
  return Promise.resolve({ text: 'ok', link: null, choices: [] });
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

function chips(fixture: ComponentFixture<AssistantPage>): HTMLButtonElement[] {
  return Array.from(host(fixture).querySelectorAll('button.choice'));
}

const LINK: AssistantListLink = {
  zoneId: 'z1',
  listId: 'l1',
  label: 'Weekly shop',
  zoneLabel: null,
};

const CHOICES: readonly AssistantChoice[] = [
  { label: 'Weekly shop · Flat 3B', message: 'the weekly shop' },
  { label: 'Shopping · Office', message: 'the office one' },
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

  describe('the one link under a reply', () => {
    it('draws exactly one, to the list, with the mounted path', async () => {
      // Plan 0042, section 3. A row of chips, one per thing the turn touched, was a
      // bill of materials; what somebody wants is to go to the list.
      const fixture = await render({
        answer: () =>
          Promise.resolve({ text: 'Yes.', link: LINK, choices: [] }),
      });

      await say(fixture, 'Is there milk?');

      expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
        '/velista/en/zones/z1/lists/l1',
      ]);
    });

    it('draws the same link correctly on velista own origin', async () => {
      // The reason the path is built with `appPath` rather than assembled: a
      // hardcoded one is wrong in exactly one of the two run modes, and it is the mode
      // nobody looks at (section 7).
      const fixture = await render({
        basePath: '',
        answer: () =>
          Promise.resolve({ text: 'Yes.', link: LINK, choices: [] }),
      });

      await say(fixture, 'Is there milk?');

      expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
        '/en/zones/z1/lists/l1',
      ]);
    });

    it('goes to the list itself, never to one of its sheets', async () => {
      // All three of the list page's line sheets **do** something to a line and none
      // of them simply shows one, so a link in a chat message must not open one.
      const fixture = await render({
        basePath: '',
        answer: () =>
          Promise.resolve({ text: 'Added.', link: LINK, choices: [] }),
      });

      await say(fixture, 'Add milk');

      const href = links(fixture)[0].getAttribute('href');
      expect(href).toBe('/en/zones/z1/lists/l1');
      expect(href).not.toContain('/edit');
      expect(href).not.toContain('/comments');
      expect(href).not.toContain('/confirm');
      expect(href).not.toContain('line=');
    });

    it('renders link-shaped prose as text and draws nothing from it', async () => {
      // The reply is never parsed for ids and never rendered as markdown. An id in a
      // sentence has none of the properties an id in `link` has, and a link to a list
      // that was never there is worse than no link at all.
      const fixture = await render({
        answer: () =>
          Promise.resolve({
            text: 'It is on https://example.test/zones/z9 and [here](/velista/en/zones/z9).',
            link: null,
            choices: [],
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

  /**
   * The answers to a question the assistant asked (plan 0042, section 4).
   *
   * The behaviour worth locking down is not that chips render, it is that tapping one
   * is indistinguishable from typing it, and that only the newest question may be
   * answered.
   */
  describe('the answers you can tap', () => {
    /** Asks once, then answers whatever it is told next. */
    function asksThenAnswers() {
      let asked = false;

      return () => {
        if (asked) {
          return Promise.resolve({
            text: 'Added to the weekly shop.',
            link: LINK,
            choices: [],
          });
        }

        asked = true;
        return Promise.resolve({
          text: 'Which list did you mean?',
          link: null,
          choices: CHOICES,
        });
      };
    }

    it('draws a chip per answer under the question', async () => {
      const fixture = await render({ answer: asksThenAnswers() });

      await say(fixture, 'Add milk');

      expect(chips(fixture).map((chip) => chip.textContent?.trim())).toEqual([
        'Weekly shop · Flat 3B',
        'Shopping · Office',
      ]);
      // A turn that asks sends nobody anywhere.
      expect(links(fixture)).toHaveLength(0);
    });

    it('sends the answer the way a typed message goes, bubble and all', async () => {
      // Section 4.2. The caller's own bubble shows the text that was sent, so there is
      // no second request shape and nothing new for the store to remember.
      const fixture = await render({ answer: asksThenAnswers() });

      await say(fixture, 'Add milk');
      chips(fixture)[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const bubbles = Array.from(
        host(fixture).querySelectorAll('lib-assistant-message .bubble')
      ).map((bubble) => bubble.textContent?.trim());

      expect(bubbles).toContain('the weekly shop');
      expect(bubbles).toContain('Added to the weekly shop.');
    });

    it('takes the chips off a question that has been answered', async () => {
      // Section 4.3. An answer to a question three turns ago is a wrong answer, and a
      // chip that is still tappable is a chip that invites it.
      const fixture = await render({ answer: asksThenAnswers() });

      await say(fixture, 'Add milk');
      chips(fixture)[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(chips(fixture)).toHaveLength(0);
      // The question is still readable, which is what matters: it was asked in words
      // and the words are still there.
      expect(host(fixture).textContent).toContain('Which list did you mean?');
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
