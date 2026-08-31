import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  COMMENT_SERVICE,
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  type CommentServiceI,
  type FakeLineStore,
} from '@portfolio/velista/data-access';
import type {
  Comment,
  CommentTranscription,
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  AUDIO_CAPTURE,
  provideVelistaTesting,
  type AudioCaptureI,
  type AudioCaptureSession,
} from '@portfolio/velista/platform';
import { CommentComposer, SheetShell } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { CommentsSheet } from './comments-sheet';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';

function comment(id: string, body: string, minutesAgo: number): Comment {
  return {
    id,
    lineId: LINE_ID,
    authorUserId: 'user-toni',
    body,
    // A typed comment: no recording, and therefore no transcript to wait for.
    // The voice cases below build their own.
    recording: null,
    transcription: null,
    createdAt: new Date(Date.UTC(2026, 7, 28, 12, 0) - minutesAgo * 60_000),
  };
}

/** A comment that is a recording, in whichever transcription state is under test. */
function voiceComment(
  id: string,
  body: string,
  transcription: CommentTranscription,
  minutesAgo: number
): Comment {
  return {
    ...comment(id, body, minutesAgo),
    recording: {
      contentType: 'audio/webm',
      byteLength: 40_000,
      durationSeconds: 13,
    },
    transcription,
  };
}

/**
 * The endpoint's order, and so the store's: newest first. Every test here hands the
 * sheet that order, because turning it round is the behaviour under test.
 */
const NEWEST_FIRST = [
  comment('c-3', 'and olives', 1),
  comment('c-2', 'the sourdough one', 5),
  comment('c-1', 'which bread?', 30),
];

function list(permissions: readonly ListPermission[]): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: 'user-1',
    autoApproveLines: false,
    lineCount: 1,
    readyCount: 0,
    myPermissions: permissions,
  };
}

/**
 * A microphone that is never a microphone (plan 0039, section 8).
 *
 * No spec here touches a real device, a real media element's network, or the wire.
 * `open` hands back a session whose `stop` resolves whatever blob the test asked
 * for, which is the whole of what the composer needs from the platform.
 */
function fakeVoiceCapture(
  options: { supported?: boolean; blob?: Blob; failOpen?: boolean } = {}
): AudioCaptureI & { closed: number } {
  const blob =
    options.blob ?? new Blob(['x'.repeat(64)], { type: 'audio/webm' });
  const capture = {
    closed: 0,
    supported: () => options.supported !== false,
    open: async (): Promise<AudioCaptureSession> => {
      if (options.failOpen === true) {
        throw new Error('permission refused');
      }
      return {
        pause: () => undefined,
        resume: () => undefined,
        stop: async () => blob,
        close: () => {
          capture.closed += 1;
        },
      };
    },
  };
  return capture;
}

interface RenderOptions {
  page?: readonly Comment[];
  permissions?: readonly ListPermission[];
  capture?: AudioCaptureI;
  /** What `addVoiceComment` does. Throwing is how a failed send is driven. */
  addVoice?: CommentServiceI['addVoiceComment'];
  audioUrl?: CommentServiceI['commentAudioUrl'];
}

async function render(
  pageOrOptions: readonly Comment[] | RenderOptions = NEWEST_FIRST,
  permissionsArg: readonly ListPermission[] = ['READ', 'WRITE']
): Promise<{
  fixture: ComponentFixture<CommentsSheet>;
  lines: FakeLineStore;
  voiceSends: { blob: Blob; durationSeconds: number }[];
}> {
  const options: RenderOptions = Array.isArray(pageOrOptions)
    ? { page: pageOrOptions, permissions: permissionsArg }
    : (pageOrOptions as RenderOptions);

  const page = options.page ?? NEWEST_FIRST;
  const permissions = options.permissions ?? permissionsArg;

  TestBed.resetTestingModule();

  const lines = fakeLineStore();
  const voiceSends: { blob: Blob; durationSeconds: number }[] = [];

  const comments: CommentServiceI = {
    listComments: async () => ({ items: [...page], nextCursor: null }),
    addComment: async (lineId, body) => ({
      id: 'c-new',
      lineId,
      authorUserId: 'user-1',
      body,
      recording: null,
      transcription: null,
      createdAt: new Date(Date.UTC(2026, 7, 28, 12, 1)),
    }),
    addVoiceComment: async (lineId, blob, durationSeconds) => {
      voiceSends.push({ blob, durationSeconds });
      if (options.addVoice !== undefined) {
        return options.addVoice(lineId, blob, durationSeconds);
      }
      return {
        id: 'c-voice',
        lineId,
        authorUserId: 'user-1',
        // No body yet, which is what the server really answers: the transcript
        // arrives afterwards as `comment.updated`.
        body: '',
        recording: {
          contentType: blob.type,
          byteLength: blob.size,
          durationSeconds,
        },
        transcription: 'PENDING' as CommentTranscription,
        createdAt: new Date(Date.UTC(2026, 7, 28, 12, 2)),
      };
    },
    commentAudioUrl: options.audioUrl ?? (async (id) => `blob:${id}`),
  };

  await TestBed.configureTestingModule({
    imports: [CommentsSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(lines),
      provideFakeListStore(
        fakeListStore({ lists: [list(permissions)], state: 'loaded' })
      ),
      provideFakeMemberNames(fakeMemberNames({ 'user-toni': 'Toni' })),
      provideFakeSessionStore('REGISTERED'),
      { provide: COMMENT_SERVICE, useValue: comments },
      {
        provide: AUDIO_CAPTURE,
        useValue: options.capture ?? fakeVoiceCapture(),
      },
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: route() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommentsSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, lines, voiceSends };
}

/** The shape `route-params.ts` reads: a real `paramMap` observable plus a snapshot. */
function route() {
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  return {
    paramMap: of(map),
    snapshot: { paramMap: map, parent: null },
    parent: null,
  };
}

function bodies(fixture: ComponentFixture<CommentsSheet>): string[] {
  return fixture.debugElement
    .queryAll(By.css('.comment .body'))
    .map((row) => (row.nativeElement as HTMLElement).textContent?.trim() ?? '');
}

/**
 * The shell's body, which is the one thing in the sheet that scrolls (plan 0040).
 */
function scroller(fixture: ComponentFixture<CommentsSheet>): HTMLElement {
  return fixture.debugElement
    .query(By.directive(SheetShell))
    .componentInstance.body().nativeElement as HTMLElement;
}

/**
 * Give an element a scroll position, which jsdom otherwise reports as zero on
 * everything and therefore as always sitting at the bottom.
 */
function fakeScroll(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
): void {
  let top = metrics.scrollTop;

  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
}

describe('CommentsSheet', () => {
  it('reads like a chat: oldest at the top, newest at the bottom', async () => {
    const { fixture } = await render();

    expect(bodies(fixture)).toEqual([
      'which bread?',
      'the sourdough one',
      'and olives',
    ]);
  });

  it('puts a comment the reader posts at the bottom', async () => {
    const { fixture } = await render();

    await fixture.componentInstance.send('and the olives');
    fixture.detectChanges();

    expect(bodies(fixture).at(-1)).toBe('and the olives');
  });

  it('puts a comment somebody else posts at the bottom too', async () => {
    const { fixture, lines } = await render();

    // What the socket does: `comment.added` reaches the store, never the sheet.
    lines.addComment(comment('c-4', 'got them', 0));
    fixture.detectChanges();

    expect(bodies(fixture).at(-1)).toBe('got them');
  });

  /**
   * Plan 0040, section 3. The conversation had a 40vh cap and a scroll of its own,
   * which was the only way to keep the composer in view before `SheetShell` had a
   * footer. Both are gone, so the sheet scrolls in exactly one place and the composer
   * is out of that scroll entirely.
   *
   * The cap itself is not assertable here: jsdom loads no stylesheet, so every computed
   * value comes back empty and a check on `max-block-size` would pass whatever the SCSS
   * said. What is assertable is which element the sheet measures, and that is the one
   * that fails silently when it is wrong.
   */
  describe('one scroll, and it is the shell body (plan 0040)', () => {
    it('measures the shell body rather than the conversation', async () => {
      const { fixture } = await render();
      const conversation = fixture.debugElement.query(By.css('.comments'))
        .nativeElement as HTMLElement;

      expect(scroller(fixture)).not.toBe(conversation);
      expect(scroller(fixture).contains(conversation)).toBe(true);
    });

    it('keeps the composer out of the scroll', async () => {
      const { fixture } = await render(NEWEST_FIRST, ['READ', 'WRITE']);
      const composer = fixture.debugElement.query(By.directive(CommentComposer))
        .nativeElement as HTMLElement;

      expect(scroller(fixture).contains(composer)).toBe(false);
    });

    it('sticks to the newest comment when the reader is already there', async () => {
      const { fixture, lines } = await render();
      const body = scroller(fixture);
      fakeScroll(body, {
        scrollHeight: 1000,
        clientHeight: 200,
        scrollTop: 800,
      });

      body.dispatchEvent(new Event('scroll'));
      lines.addComment(comment('c-4', 'got them', 0));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(body.scrollTop).toBe(1000);
    });

    it('leaves a reader who has scrolled up where they were', async () => {
      // The failure this guards is silent: bound to an element that no longer scrolls,
      // the tracker never fires, the sheet believes it is always at the bottom, and it
      // yanks somebody reading an older comment back down every time anybody speaks.
      const { fixture, lines } = await render();
      const body = scroller(fixture);
      fakeScroll(body, {
        scrollHeight: 1000,
        clientHeight: 200,
        scrollTop: 100,
      });

      body.dispatchEvent(new Event('scroll'));
      lines.addComment(comment('c-4', 'got them', 0));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(body.scrollTop).toBe(100);
    });
  });

  it('leaves an empty conversation alone', async () => {
    const { fixture } = await render([]);

    expect(bodies(fixture)).toEqual([]);
    expect(fixture.debugElement.query(By.css('.comments'))).toBeNull();
  });

  /**
   * Plan 0030, section 3.1, and acceptance item 1.
   *
   * The sheet opens for everybody who holds READ and the composer is what leaves, in
   * its place rather than simply gone: `0027` pinned it under the conversation, which
   * makes it the most prominent thing here and always in view, and that is exactly the
   * control that must not be drawn for somebody who cannot use it.
   */
  describe('who may say something', () => {
    it('draws the composer for a writer', async () => {
      const { fixture } = await render(NEWEST_FIRST, ['READ', 'WRITE']);

      expect(
        fixture.debugElement.query(By.css('lib-comment-composer'))
      ).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.read-only'))).toBeNull();
    });

    it('draws it for somebody who only decides, too', async () => {
      const { fixture } = await render(NEWEST_FIRST, ['READ', 'DECIDE']);

      expect(
        fixture.debugElement.query(By.css('lib-comment-composer'))
      ).not.toBeNull();
    });

    it('still shows a reader the conversation, and not the composer', async () => {
      const { fixture } = await render(NEWEST_FIRST, ['READ']);

      expect(bodies(fixture)).toEqual([
        'which bread?',
        'the sourdough one',
        'and olives',
      ]);
      expect(
        fixture.debugElement.query(By.css('lib-comment-composer'))
      ).toBeNull();
    });

    it('puts the note where the composer was, so the sheet does not end in nothing', async () => {
      const { fixture } = await render(NEWEST_FIRST, ['READ']);

      expect(
        fixture.debugElement.query(By.css('.read-only'))?.nativeElement
          .textContent
      ).toContain('list.comments.readOnly');
    });
  });

  /** Plan 0039. Nothing here touches a real microphone, media element or socket. */
  describe('a comment can be a recording', () => {
    it('draws one button, which is a microphone on an empty field', async () => {
      const { fixture } = await render();
      const composer = fixture.debugElement.query(
        By.css('lib-comment-composer')
      );

      // The assistant's rule, adopted whole (plan 0041, section 2). Plan 0039 drew
      // the microphone beside the field instead, so that somebody who started
      // typing and changed their mind did not have to clear the box; that cost is
      // real and it is the smaller one against a second control scheme for the
      // same act, two taps from the first.
      expect(composer.query(By.css('.field'))).not.toBeNull();
      expect(composer.query(By.css('.send lib-mic-icon'))).not.toBeNull();
      expect(composer.query(By.css('.mic'))).toBeNull();
    });

    it('still draws the button where the browser cannot record', async () => {
      const { fixture } = await render({
        capture: fakeVoiceCapture({ supported: false }),
      });

      // A change from plan 0039, which drew no microphone at all here and could,
      // because the microphone sat beside a send. With one button doing both jobs
      // there is nothing left to draw on an empty field, so it stays and the
      // failure is said in words. The field never stops working, which is what
      // that rule was protecting.
      const composer = fixture.debugElement.query(
        By.css('lib-comment-composer')
      );
      expect(composer.query(By.css('.field'))).not.toBeNull();

      const instance = componentOf(fixture);
      instance.press();
      await flush();
      fixture.detectChanges();

      expect(instance.errorKey()).toBe('list.comments.micRefused');
      expect(composer.query(By.css('.field'))).not.toBeNull();
    });

    it('records on press and sends on stop, with no second press', async () => {
      const { fixture, voiceSends } = await render();
      const composer = componentOf(fixture);

      composer.press();
      await flush();
      fixture.detectChanges();
      expect(
        fixture.debugElement.query(By.css('lib-recording-row'))
      ).not.toBeNull();

      await composer.stopAndSend();
      await flush();
      fixture.detectChanges();

      // Stop sends. Plan 0039 held it for a second press on the argument that a
      // message which leaves on its own is a message nobody agreed to send, and
      // that rule is about the cap rather than the button (plan 0041, section 3).
      expect(voiceSends).toHaveLength(1);
    });

    it('says so and keeps the field working when the microphone is refused', async () => {
      const { fixture } = await render({
        capture: fakeVoiceCapture({ failOpen: true }),
      });
      const composer = componentOf(fixture);

      composer.press();
      await flush();
      fixture.detectChanges();

      expect(composer.errorKey()).toBe('list.comments.micRefused');
      expect(
        fixture.debugElement.query(By.css('lib-comment-composer .field'))
      ).not.toBeNull();
    });

    it('shows a pending bubble while a recording uploads, with no invented words', async () => {
      let release: (() => void) | undefined;
      const { fixture } = await render({
        addVoice: () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                id: 'c-voice',
                lineId: LINE_ID,
                authorUserId: 'user-1',
                body: '',
                recording: {
                  contentType: 'audio/webm',
                  byteLength: 64,
                  durationSeconds: 4,
                },
                transcription: 'PENDING' as CommentTranscription,
                createdAt: new Date(Date.UTC(2026, 7, 28, 12, 2)),
              });
          }),
      });
      const composer = componentOf(fixture);

      composer.press();
      await flush();
      // `stopAndSend` emits and returns; the sheet does the sending. So it is not
      // awaited here, which is also what a real press is.
      void composer.stopAndSend();
      await flush();
      fixture.detectChanges();

      // In the caller's own position, at the bottom, saying it is being sent and
      // showing no guess at the words: the client has nothing to guess from.
      const drawn = bodies(fixture);
      expect(drawn[drawn.length - 1]).toBe('list.comments.sending');

      release?.();
      await flush();
      fixture.detectChanges();

      expect(bodies(fixture)).not.toContain('list.comments.sending');
    });

    it('keeps the recording when the send fails, which is what matters most here', async () => {
      const { fixture } = await render({
        addVoice: async () => {
          throw new Error('the connection dropped');
        },
      });
      const composer = componentOf(fixture);

      composer.press();
      await flush();
      void composer.stopAndSend();
      await flush();
      fixture.detectChanges();

      // Somebody just spoke. Losing that to a dropped connection is the worst
      // outcome in the plan, so the blob stays and the error line carries a retry
      // that sends the same bytes (plan 0041, section 7).
      expect(composer.hasHeldRecording()).toBe(true);
      expect(composer.errorKey()).not.toBeNull();
      expect(bodies(fixture)).not.toContain('list.comments.sending');
      expect(
        fixture.debugElement.query(By.css('lib-comment-composer .retry'))
      ).not.toBeNull();
    });

    it('draws a player only for a comment that has a recording', async () => {
      const { fixture } = await render({
        page: [
          voiceComment('c-v', 'Bring the big one', 'READY', 2),
          comment('c-t', 'Typed, no recording', 5),
        ],
      });

      expect(
        fixture.debugElement.queryAll(By.css('lib-audio-player'))
      ).toHaveLength(1);
    });

    it('reads a voice comment as text, so the existing row covers it unchanged', async () => {
      const { fixture } = await render({
        page: [voiceComment('c-v', 'Bring the big one', 'READY', 2)],
      });

      // The transcript **is** the body: same bubble, same order, same component.
      // That is the cheapest evidence section 3's decision was the right one.
      expect(bodies(fixture)).toEqual(['Bring the big one']);
    });

    it('says which kind of silence an empty body is', async () => {
      const waiting = await render({
        page: [voiceComment('c-v', '', 'PENDING', 2)],
      });
      expect(bodies(waiting.fixture)).toEqual(['list.comments.transcribing']);

      const never = await render({
        page: [voiceComment('c-v', '', 'FAILED', 2)],
      });
      // A recording nobody could transcribe is still a message somebody left, and
      // it still plays.
      expect(bodies(never.fixture)).toEqual(['list.comments.noTranscript']);
      expect(
        never.fixture.debugElement.query(By.css('lib-audio-player'))
      ).not.toBeNull();
    });

    it('downloads nothing until something is played', async () => {
      const fetched: string[] = [];
      const { fixture } = await render({
        page: [
          voiceComment('c-1', 'one', 'READY', 3),
          voiceComment('c-2', 'two', 'READY', 2),
          voiceComment('c-3', 'three', 'READY', 1),
        ],
        audioUrl: async (id) => {
          fetched.push(id);
          return `blob:${id}`;
        },
      });

      // Three players drawn, and nothing asked for. The length on each row comes
      // from the comment rather than from the file, which is what lets the row be
      // correct before anything exists.
      expect(
        fixture.debugElement.queryAll(By.css('lib-audio-player'))
      ).toHaveLength(3);
      expect(fetched).toEqual([]);
    });
  });
});

/**
 * Let every pending promise settle.
 *
 * A press on send emits and returns; the sheet does the sending, and nothing in
 * the component tree is awaiting it. `whenStable` does not cover that, so the
 * queue is drained explicitly rather than by guessing at a number of microtasks.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The composer instance, for the presses a template cannot make on its own. */
function componentOf(
  fixture: ComponentFixture<CommentsSheet>
): CommentComposer {
  return fixture.debugElement.query(By.directive(CommentComposer))
    .componentInstance as CommentComposer;
}
