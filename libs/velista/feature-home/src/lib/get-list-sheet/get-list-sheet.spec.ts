import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  GeneratedListStore,
  LIST_SERVICE,
  provideFakeSessionStore,
  provideFakeZoneStore,
  ShoppingProfileStore,
  type ListServiceI,
} from '@portfolio/velista/data-access';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  MyZone,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { GetListSheet } from './get-list-sheet';

/**
 * Get shopping list (plan 0045, section 3.4).
 *
 * What is worth testing here is the **selection**, because it is the one thing on this
 * screen with a rule behind it: a group ticked whole means every list in it the caller
 * can write to including ones made later, which is a different thing from naming
 * today's list ids, and the difference has to survive to the wire.
 */

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'z1',
    name: 'Flat 3B',
    joinCode: 'FLAT3B',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
    ...overrides,
  };
}

function list(
  id: string,
  name: string,
  permissions: readonly string[] = ['READ', 'WRITE']
): ShoppingListSummary {
  return {
    id,
    zoneId: 'z1',
    name,
    createdByUserId: 'u1',
    autoApproveLines: true,
    sharedWithZone: true,
    lineCount: 3,
    readyCount: 0,
    myPermissions: permissions,
  } as ShoppingListSummary;
}

interface Options {
  readonly zones?: readonly MyZone[];
  readonly lists?: Readonly<Record<string, readonly ShoppingListSummary[]>>;
  readonly createRejects?: boolean;
}

/** Records what the sheet asked the store to compose. */
const created: CreateGeneratedListRequest[] = [];

async function render(
  options: Options = {}
): Promise<ComponentFixture<GetListSheet>> {
  TestBed.resetTestingModule();
  created.length = 0;

  const listService: Partial<ListServiceI> = {
    listLists: async (zoneId: string) => ({
      items: [...(options.lists?.[zoneId] ?? [])],
      nextCursor: null,
    }),
  };

  const generated = {
    create: async (request: CreateGeneratedListRequest) => {
      created.push(request);
      if (options.createRejects) {
        throw new Error('refused');
      }
      return {
        list: {
          id: 'made',
          name: request.name ?? null,
          status: 'ACTIVE',
          generatedAt: new Date(),
          lineCount: 3,
          settledLineCount: 0,
        },
        skipped: [],
      } as GeneratedListRun;
    },
  };

  // Only `profiles` is read, and only to decide whether the chooser is drawn at all.
  const profiles = { profiles: () => [], load: async () => undefined };

  await TestBed.configureTestingModule({
    imports: [GetListSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(),
      provideFakeSessionStore('REGISTERED'),
      provideFakeZoneStore(fakeZoneStore({ zones: options.zones ?? [zone()] })),
      { provide: LIST_SERVICE, useValue: listService },
      { provide: ShoppingProfileStore, useValue: profiles },
      // The real store's own behaviour is covered by its spec; here it is a recorder,
      // so what is under test is what the sheet decides to send.
      { provide: GeneratedListStore, useValue: generated },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(GetListSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const query = (fixture: ComponentFixture<GetListSheet>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector);

const all = (fixture: ComponentFixture<GetListSheet>, selector: string) =>
  Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ) as HTMLElement[];

describe('GetListSheet', () => {
  describe('the sources', () => {
    // The correct default and the cheapest first frame at once: no list request is
    // made at all until somebody narrows something.
    it('starts with every group ticked whole and asks for no lists', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
      });

      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: null },
        { zoneId: 'z2', listId: null },
      ]);
      expect(fixture.componentInstance.listsOf('z1')).toBeUndefined();
    });

    it('unticks a whole group, which drops it from the sources', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
      });

      fixture.componentInstance.toggleZone('z1');

      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z2', listId: null },
      ]);
    });

    it('fetches a group s lists only when it is expanded', async () => {
      const fixture = await render({
        lists: { z1: [list('l1', 'Weekly shop')] },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();

      expect(fixture.componentInstance.listsOf('z1')?.state).toBe('loaded');
    });

    /**
     * Backend `0051` section 2 gates a run on `WRITE` over its sources, so a list the
     * caller can only read is a tick the server would refuse on submit. It is left out
     * entirely rather than drawn and disabled, which is `0030`'s rule.
     */
    it('offers only the lists the caller can write to', async () => {
      const fixture = await render({
        lists: {
          z1: [
            list('writable', 'Weekly shop'),
            list('readonly', 'Someone else s', ['READ']),
          ],
        },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();

      expect(
        fixture.componentInstance.listsOf('z1')?.lists.map((l) => l.id)
      ).toEqual(['writable']);
    });

    /**
     * The rule this screen exists to get right. Unticking one list turns the group from
     * `ALL` into the explicit set of everything else, so the wire carries list ids
     * rather than a null that would silently include the one just unticked.
     */
    it('turns a group into explicit lists when one is unticked', async () => {
      const fixture = await render({
        lists: { z1: [list('l1', 'Weekly shop'), list('l2', 'Costco run')] },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();
      fixture.componentInstance.toggleList('z1', 'l2');

      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: 'l1' },
      ]);
      expect(fixture.componentInstance.zoneState('z1')).toBe('some');
    });

    /**
     * Ticking everything back returns the group to `ALL` rather than leaving today's
     * ids frozen in. Otherwise an interaction that looks like it restored the previous
     * state would quietly break the "including lists made later" promise.
     */
    it('returns to the whole group when every list is ticked again', async () => {
      const fixture = await render({
        lists: { z1: [list('l1', 'Weekly shop'), list('l2', 'Costco run')] },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();
      fixture.componentInstance.toggleList('z1', 'l2');
      fixture.componentInstance.toggleList('z1', 'l2');

      expect(fixture.componentInstance.zoneState('z1')).toBe('all');
      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: null },
      ]);
    });

    it('says what is needed rather than showing a dead tree with no groups', async () => {
      const fixture = await render({ zones: [] });

      expect(fixture.componentInstance.noSources()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'getList.sources.none'
      );
      expect(query(fixture, '.tree')).toBeNull();
    });

    it('refuses to submit with nothing ticked', async () => {
      const fixture = await render();

      fixture.componentInstance.toggleZone('z1');

      expect(fixture.componentInstance.canSubmit()).toBe(false);
    });
  });

  describe('submitting', () => {
    it('sends the ticked sources and an empty name as null', async () => {
      const fixture = await render();

      await fixture.componentInstance.submit();

      expect(created).toHaveLength(1);
      expect(created[0]?.name).toBeNull();
      expect(created[0]?.sources).toEqual([{ zoneId: 'z1', listId: null }]);
    });

    it('sends a typed name, trimmed', async () => {
      const fixture = await render();

      fixture.componentInstance.name.set('  Saturday big shop  ');
      await fixture.componentInstance.submit();

      expect(created[0]?.name).toBe('Saturday big shop');
    });

    /**
     * The key is minted once per **opening** of the sheet and not per press, which is
     * what makes a double tap return the first run rather than composing a second. A
     * key made at submit time would be a different key on the second tap, which is
     * exactly the thing it exists to prevent.
     */
    it('sends the same idempotency key on a second press', async () => {
      const fixture = await render({ createRejects: true });

      await fixture.componentInstance.submit();
      fixture.detectChanges();
      await fixture.componentInstance.submit();

      expect(created).toHaveLength(2);
      expect(created[0]?.idempotencyKey).toBeDefined();
      expect(created[1]?.idempotencyKey).toBe(created[0]?.idempotencyKey);
    });

    it('keeps the sheet open and reports a failure, losing nothing', async () => {
      const fixture = await render({ createRejects: true });

      fixture.componentInstance.name.set('Tonight');
      await fixture.componentInstance.submit();
      fixture.detectChanges();

      expect(fixture.componentInstance.errorKey()).toBe('getList.error');
      expect(fixture.componentInstance.submitting()).toBe(false);
      // Nothing lost: the name and the ticks are still there to try again with.
      expect(fixture.componentInstance.name()).toBe('Tonight');
      expect(fixture.componentInstance.sources()).toHaveLength(1);
    });
  });

  /**
   * Plan 0045 section 3.1. The dashboard's History link lives in the shopping list
   * card's header, so it goes away with the card; somebody whose baskets are all
   * finished has no card and would otherwise have no route to their own history at all.
   * This sheet is where the plan puts it, and the test exists because the failure is
   * invisible: nothing breaks, a page simply becomes unreachable.
   */
  describe('the way to the history', () => {
    it('offers it from the header, even with no active basket to have a card', async () => {
      const fixture = await render();

      expect(query(fixture, '.history')).not.toBeNull();
    });

    it('is drawn beside the title rather than beside the submit', async () => {
      const fixture = await render();

      expect(query(fixture, '.head-row .history')).not.toBeNull();
    });

    it('is offered even when there is nowhere to draw from', async () => {
      // The one case where the sheet can do nothing else for you is exactly the case
      // where looking at what you already have is the useful thing left.
      const fixture = await render({ zones: [] });

      expect(fixture.componentInstance.noSources()).toBe(true);
      expect(query(fixture, '.history')).not.toBeNull();
    });
  });

  describe('the profile row', () => {
    // A chooser with one choice is furniture (plan 0046, section 3.2).
    it('is absent for somebody with one profile', async () => {
      const fixture = await render();

      expect(fixture.componentInstance.showProfiles()).toBe(false);
      expect(query(fixture, '.profile-select')).toBeNull();
    });
  });

  describe('the checkbox tree', () => {
    it('gives a group a disclosure button and a checkbox, not one target for both', async () => {
      const fixture = await render();

      expect(
        query(fixture, '.zone-disclosure')?.getAttribute('aria-expanded')
      ).toBe('false');
      expect(query(fixture, '.zone-row .tick')?.getAttribute('role')).toBe(
        'checkbox'
      );
    });

    it('reports the group as mixed when its lists disagree', async () => {
      const fixture = await render({
        lists: { z1: [list('l1', 'Weekly shop'), list('l2', 'Costco run')] },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();
      fixture.componentInstance.toggleList('z1', 'l2');
      fixture.detectChanges();

      expect(
        query(fixture, '.zone-row .tick')?.getAttribute('aria-checked')
      ).toBe('mixed');
    });

    it('marks every list row as a checkbox', async () => {
      const fixture = await render({
        lists: { z1: [list('l1', 'Weekly shop')] },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();
      fixture.detectChanges();

      const rows = all(fixture, '.list-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.getAttribute('role')).toBe('checkbox');
      expect(rows[0]?.getAttribute('aria-checked')).toBe('true');
    });
  });
});
