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
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
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
    createdAt: new Date(Date.UTC(2026, 7, 28, 12, 0) - minutesAgo * 60_000),
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

async function render(
  page: readonly Comment[] = NEWEST_FIRST,
  permissions: readonly ListPermission[] = ['READ', 'WRITE']
): Promise<{ fixture: ComponentFixture<CommentsSheet>; lines: FakeLineStore }> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore();
  const comments: CommentServiceI = {
    listComments: async () => ({ items: [...page], nextCursor: null }),
    addComment: async (lineId, body) => ({
      id: 'c-new',
      lineId,
      authorUserId: 'user-1',
      body,
      createdAt: new Date(Date.UTC(2026, 7, 28, 12, 1)),
    }),
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
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: route() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommentsSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, lines };
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
});
