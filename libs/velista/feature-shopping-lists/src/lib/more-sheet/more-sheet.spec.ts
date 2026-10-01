import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import type {
  BasketAddress,
  BasketParticipant,
  BasketPresenceEntry,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { MoreSheet } from './more-sheet';

/**
 * The basket's menu (velista `0130`, section 6.1).
 *
 * Four things are worth asserting and the rest is copy.
 *
 * **The order is fixed**: people, the history, a new shopping list, finish.
 *
 * **A row is absent when its button would have been**, each under the condition the
 * header's own control had: the history and a new list need an account, finish is the
 * owner's on a basket that has an end, and the people row needs somebody to read
 * about. These are the same facts the page asks before it draws the button that opens
 * this, through the one function they share.
 *
 * **Finish needs a finish sheet under it.** `shopping-lists/live` declares none, so
 * the row is not drawn there whatever the basket says.
 *
 * **Every row replaces this sheet** with `leaveTo`, so back from where it leads lands
 * on the basket and never on a menu nobody asked to see again.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

type Kind = BasketParticipant['kind'];

function person(kind: Kind, id = `p-${kind.toLowerCase()}`): BasketParticipant {
  return {
    id,
    kind,
    displayName: null,
    username: null,
    guestNumber: kind === 'GUEST' ? 1 : null,
    userId: kind === 'GUEST' ? null : `u-${id}`,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
    expiresAt: null,
  };
}

function here(participant: BasketParticipant): BasketPresenceEntry {
  return {
    participantId: participant.id,
    kind: participant.kind,
    displayName: participant.displayName,
    guestNumber: participant.guestNumber,
    userId: participant.userId,
  };
}

interface World {
  /** Who is reading. The owner unless a test says otherwise. */
  readonly me?: BasketParticipant | null;
  /** Everybody who can open the basket. */
  readonly participants?: readonly BasketParticipant[];
  /** Who is holding it open right now. */
  readonly present?: readonly BasketPresenceEntry[];
  readonly kind?: 'GENERATED' | 'LIVE';
  readonly finished?: boolean;
  /** Whether the page's route declares a finish sheet. It does on a trip. */
  readonly finishSheet?: boolean;
  /** `?search=1`, the search that was open under the menu. */
  readonly search?: boolean;
  readonly basePath?: string;
}

async function render(world: World = {}): Promise<{
  fixture: ComponentFixture<MoreSheet>;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const kind = world.kind ?? 'GENERATED';
  const me = world.me === undefined ? person('OWNER') : world.me;
  const participants = world.participants ?? [];
  const address: BasketAddress =
    kind === 'LIVE' ? 'live' : { basketId: BASKET_ID };

  const basket = {
    basket: signal({
      id: BASKET_ID,
      kind,
      name: 'Saturday shop',
      status: (world.finished ?? false) ? 'FINISHED' : 'OPEN',
      createdAt: null,
      rows: [],
      lists: [],
      participants,
      me,
      products: new Map(),
      scopes: new Map(),
      shop: null,
      progress: { done: 0, unavailable: 0, total: 0 },
      pending: 0,
      unseenChangeCount: 0,
      newestUnseenChangeId: null,
    }),
    me: signal(me),
    participants: signal(participants),
    present: signal(world.present ?? []),
    address: signal<BasketAddress | null>(address),
  };
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const queryParamMap = convertToParamMap(
    world.search === true ? { search: '1' } : {}
  );
  const finishSheet = world.finishSheet ?? kind !== 'LIVE';

  await TestBed.configureTestingModule({
    imports: [MoreSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: world.basePath ?? '/velista' }),
      { provide: BasketStore, useValue: basket },
      { provide: SheetNavigation, useValue: sheets },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap },
          // The page's route, whose children are the sheets declared over it.
          parent: {
            routeConfig: {
              children: [
                { path: 'sheet/people' },
                { path: 'sheet/more' },
                { path: 'sheet/get' },
                ...(finishSheet ? [{ path: 'sheet/finish' }] : []),
              ],
            },
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MoreSheet);
  fixture.detectChanges();

  return { fixture, sheets };
}

/** The rows, by what each is about, in the order they are drawn. */
const entries = (fixture: ComponentFixture<MoreSheet>): string[] =>
  Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      'button.row'
    )
  ).map((row) => row.dataset['entry'] ?? '');

const row = (
  fixture: ComponentFixture<MoreSheet>,
  entry: string
): HTMLButtonElement | null =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    `button.row[data-entry="${entry}"]`
  );

describe('MoreSheet', () => {
  describe('the rows', () => {
    it('draws all four for the owner of a trip, in the plan’s order', async () => {
      const owner = person('OWNER');
      const { fixture } = await render({ me: owner, participants: [owner] });

      expect(entries(fixture)).toEqual([
        'people',
        'history',
        'create',
        'finish',
      ]);
    });

    it('gives each one its icon and its word', async () => {
      const owner = person('OWNER');
      const { fixture } = await render({ me: owner, participants: [owner] });

      expect(row(fixture, 'people')?.querySelector('lib-person-icon')).not.toBe(
        null
      );
      expect(row(fixture, 'history')?.querySelector('lib-clock-icon')).not.toBe(
        null
      );
      expect(row(fixture, 'create')?.querySelector('lib-plus-icon')).not.toBe(
        null
      );
      expect(row(fixture, 'finish')?.querySelector('lib-flag-icon')).not.toBe(
        null
      );

      expect(row(fixture, 'people')?.textContent).toContain(
        'basket.more.people'
      );
      // The word the history's own button was named by.
      expect(row(fixture, 'history')?.textContent).toContain(
        'basket.openHistory'
      );
      expect(row(fixture, 'create')?.textContent).toContain(
        'basket.more.create'
      );
      expect(row(fixture, 'finish')?.textContent).toContain(
        'basket.more.finish'
      );
    });

    it('is named by its title', async () => {
      const { fixture } = await render();
      const title = (fixture.nativeElement as HTMLElement).querySelector(
        '#more-title'
      );

      expect(title?.tagName).toBe('H2');
      expect(title?.textContent?.trim()).toBe('basket.more.title');
    });
  });

  describe('the people row', () => {
    it('is drawn when the basket names somebody', async () => {
      const owner = person('OWNER');
      const { fixture } = await render({ me: owner, participants: [owner] });

      expect(entries(fixture)).toContain('people');
    });

    it('is drawn when somebody is holding the basket open', async () => {
      // The faces' own condition: presence, on a basket that keeps a room.
      const owner = person('OWNER');
      const { fixture } = await render({
        me: owner,
        participants: [],
        present: [here(owner)],
      });

      expect(entries(fixture)).toContain('people');
    });

    it('is absent when there is nobody to read about', async () => {
      const { fixture } = await render({ participants: [], present: [] });

      expect(entries(fixture)).not.toContain('people');
    });

    it('does not count presence on the basket that keeps no room', async () => {
      // A `LIVE` basket has no presence room, so who is "here" is not a claim it
      // can make, and with nobody named there is nothing to open.
      const owner = person('OWNER');
      const { fixture } = await render({
        kind: 'LIVE',
        me: owner,
        participants: [],
        present: [here(owner)],
      });

      expect(entries(fixture)).not.toContain('people');
    });
  });

  describe('the history and a new list', () => {
    it('are offered to a registered participant', async () => {
      const { fixture } = await render({ me: person('REGISTERED') });

      expect(entries(fixture)).toEqual(['history', 'create']);
    });

    it('are absent for a guest, because both need an account', async () => {
      const guest = person('GUEST');
      const { fixture } = await render({ me: guest, participants: [guest] });

      expect(entries(fixture)).toEqual(['people']);
    });
  });

  describe('the finish row', () => {
    it('is the owner’s alone', async () => {
      const { fixture } = await render({ me: person('REGISTERED') });

      expect(entries(fixture)).not.toContain('finish');
    });

    it('is absent on a trip that is already over', async () => {
      const { fixture } = await render({ finished: true });

      expect(entries(fixture)).not.toContain('finish');
    });

    it('is absent on the basket that is always there', async () => {
      const { fixture } = await render({ kind: 'LIVE' });

      expect(entries(fixture)).toEqual(['history', 'create']);
    });

    it('is absent over a route with no finish sheet, whatever the basket says', async () => {
      // The row leads to a URL. Where the route table declares no such sheet the
      // row would lead nowhere, so the table is asked and not only the basket.
      const { fixture } = await render({ finishSheet: false });

      expect(entries(fixture)).toEqual(['history', 'create']);
    });
  });

  it('draws no row at all for a guest on a basket that names nobody', async () => {
    // The page draws no menu button for this reader. This is what a cold arrival on
    // the sheet's own URL finds: a title and nothing to press.
    const { fixture } = await render({ me: person('GUEST') });

    expect(entries(fixture)).toEqual([]);
  });

  /**
   * A row is a way to somewhere else, so it replaces this sheet's history entry.
   * Pushed instead, back from the people sheet would reopen the menu.
   */
  describe('where a row leads', () => {
    const owner = person('OWNER');

    it('replaces the menu with the people sheet', async () => {
      const { fixture, sheets } = await render({
        me: owner,
        participants: [owner],
      });

      row(fixture, 'people')?.click();

      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/people`
      );
    });

    it('replaces the menu with the sheet that composes a new list', async () => {
      const { fixture, sheets } = await render();

      row(fixture, 'create')?.click();

      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/get`
      );
    });

    it('replaces the menu with the finish sheet, and finishes nothing itself', async () => {
      const { fixture, sheets } = await render();

      row(fixture, 'finish')?.click();

      expect(sheets.leaveTo).toHaveBeenCalledTimes(1);
      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/finish`
      );
    });

    it('goes to the history page, so back from it is the basket', async () => {
      const { fixture, sheets } = await render();

      row(fixture, 'history')?.click();

      expect(sheets.leaveTo).toHaveBeenCalledWith('/velista/en/shopping-lists');
      expect(TestBed.inject(Router).navigateByUrl).not.toHaveBeenCalled();
    });

    it('addresses the live basket by its word, which has no id', async () => {
      const { fixture, sheets } = await render({
        kind: 'LIVE',
        me: owner,
        participants: [owner],
        basePath: '',
      });

      row(fixture, 'people')?.click();
      row(fixture, 'create')?.click();

      expect(sheets.leaveTo.mock.calls.map(([url]) => url)).toEqual([
        '/en/shopping-lists/live/sheet/people',
        '/en/shopping-lists/live/sheet/get',
      ]);
    });

    it('keeps the search that was open under it', async () => {
      const { fixture, sheets } = await render({
        me: owner,
        participants: [owner],
        search: true,
      });

      row(fixture, 'people')?.click();

      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/people?search=1`
      );
    });
  });

  it('dismisses to the basket it covers', async () => {
    const { fixture, sheets } = await render();

    fixture.componentInstance['close']();

    expect(sheets.dismiss).toHaveBeenCalledWith(
      `/velista/en/shopping-lists/${BASKET_ID}`
    );
    expect(sheets.leaveTo).not.toHaveBeenCalled();
  });
});
