import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  GeneratedListStore,
  LIST_SERVICE,
  provideFakeSessionStore,
  provideFakeZoneStore,
  SHOPPING_PROFILE_SERVICE,
  ShoppingProfileStore,
  type ListServiceI,
  type ShoppingProfileServiceI,
} from '@portfolio/velista/data-access';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  MyZone,
  ProfileGenerationScope,
  ShoppingListSummary,
  ShoppingProfile,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
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
  /**
   * The page the sheet is declared over, as its route states it.
   *
   * Left out it is the dashboard's copy, which is what an absent `returnTo` means and
   * what the route table said before the history gained a copy of its own.
   */
  readonly returnTo?: 'home' | 'shopping-lists';
  /** The profiles the chooser has to choose between. One unnamed default by default. */
  readonly profiles?: readonly ShoppingProfile[];
  /**
   * What each profile stores as its generation scope, by profile id.
   *
   * Absent for a profile means the service answers null, which is a profile that has
   * never narrowed anything and is the case the sheet falls back to prechecking
   * everything for.
   */
  readonly scopes?: Readonly<Record<string, ProfileGenerationScope>>;
  /**
   * How many lists one page of `listLists` answers with.
   *
   * Left out, every list comes back at once and no cursor is ever offered, which is
   * every test but the paging one.
   */
  readonly pageSize?: number;
}

/** One profile, named or not, for the chooser and the scope read. */
function profile(
  id: string,
  overrides: Partial<ShoppingProfile> = {}
): ShoppingProfile {
  return {
    id,
    name: null,
    isDefault: false,
    position: 0,
    addressText: null,
    minSavingCents: 0,
    postalCodes: [],
    chains: [],
    ...overrides,
  };
}

/** Records what the sheet asked the store to compose. */
const created: CreateGeneratedListRequest[] = [];

/** Every `listLists` the sheet made, so the cursor test can see it followed one. */
const listPages: { zoneId: string; cursor: string | null }[] = [];

/** Which profiles the sheet asked for a stored scope, in order. */
const scopeReads: string[] = [];

async function render(
  options: Options = {}
): Promise<ComponentFixture<GetListSheet>> {
  TestBed.resetTestingModule();
  created.length = 0;
  scopeReads.length = 0;

  listPages.length = 0;

  const listService: Partial<ListServiceI> = {
    listLists: async (
      zoneId: string,
      page?: { cursor?: string; limit?: number }
    ) => {
      listPages.push({ zoneId, cursor: page?.cursor ?? null });

      const all = [...(options.lists?.[zoneId] ?? [])];
      const size = options.pageSize;
      if (size === undefined) {
        return { items: all, nextCursor: null };
      }

      // A cursor that is simply the index of the next item, which is all a fake needs
      // it to be: the sheet must pass back whatever it was handed and stop when it is
      // handed null, and neither of those is a fact about the cursor's shape.
      const from = page?.cursor === undefined ? 0 : Number(page.cursor);
      const items = all.slice(from, from + size);
      const next = from + size;
      return {
        items,
        nextCursor: next < all.length ? String(next) : null,
      };
    },
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
          boughtLineCount: 0,
          notAvailableLineCount: 0,
          presentCount: 0,
        },
        skipped: [],
      } as GeneratedListRun;
    },
  };

  const held = options.profiles ?? [];

  // The store, for the chooser: which profiles there are, and which is the default.
  const profiles = {
    profiles: () => held,
    load: async () => undefined,
  };

  /**
   * The service, for the generation scope and nothing else.
   *
   * A second double beside the store's, which mirrors the production split exactly and
   * is the point of it (plan 0049, section 3): the scope is not on the profile the
   * store holds, so a spec cannot state one by putting a field on a profile.
   */
  const profileService: Partial<ShoppingProfileServiceI> = {
    readGenerationScope: async (profileId: string) => {
      scopeReads.push(profileId);
      return options.scopes?.[profileId] ?? null;
    },
  };

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
      { provide: SHOPPING_PROFILE_SERVICE, useValue: profileService },
      // The real store's own behaviour is covered by its spec; here it is a recorder,
      // so what is under test is what the sheet decides to send.
      { provide: GeneratedListStore, useValue: generated },
      // After `provideRouter`, so this wins: the sheet reads which page it covers from
      // its own route's data, and `provideRouter([])` has no route carrying any.
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data:
              options.returnTo === undefined
                ? {}
                : { returnTo: options.returnTo },
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(GetListSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<GetListSheet>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

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

    it('is absent over the history itself, which is where it would lead', async () => {
      // The whole reason for the link is that somebody with no card has no other route
      // to the history. Over the history that reason is gone, and a control leading to
      // the screen it is on is worse than no control.
      const fixture = await render({ returnTo: 'shopping-lists' });

      expect(fixture.componentInstance.showHistory).toBe(false);
      expect(query(fixture, '.history')).toBeNull();
    });
  });

  /**
   * Where Cancel, Escape, the scrim and the back button leave to.
   *
   * Only reached on a cold arrival at the sheet's own URL: with a page behind it in the
   * stack `SheetNavigation.dismiss` pops instead, and popping lands on whichever page
   * that was. The fallback still has to be right, because a shared or reloaded URL is
   * exactly when there is nothing to pop.
   */
  describe('the page it falls back to', () => {
    it('is the dashboard for the dashboard copy', async () => {
      const fixture = await render();
      const sheet = TestBed.inject(SheetNavigation);
      const dismiss = jest.spyOn(sheet, 'dismiss').mockResolvedValue(undefined);

      await fixture.componentInstance.dismiss();

      expect(dismiss).toHaveBeenCalledWith(expect.stringContaining('/home'));
    });

    it('is the history for the history copy', async () => {
      const fixture = await render({ returnTo: 'shopping-lists' });
      const sheet = TestBed.inject(SheetNavigation);
      const dismiss = jest.spyOn(sheet, 'dismiss').mockResolvedValue(undefined);

      await fixture.componentInstance.dismiss();

      expect(dismiss).toHaveBeenCalledWith(
        expect.stringContaining('/shopping-lists')
      );
    });
  });

  describe('the profile row', () => {
    // A chooser with one choice is furniture (plan 0046, section 3.2).
    it('is absent for somebody with one profile', async () => {
      const fixture = await render();

      expect(fixture.componentInstance.showProfiles()).toBe(false);
      expect(query(fixture, '.profile-select')).toBeNull();
    });

    /**
     * `0045` covered only the absent-with-one case, which plan 0049 section 7 asks to
     * finish: with two profiles the chooser is drawn, and the run still names whichever
     * is selected rather than letting the server pick.
     */
    it('is drawn for somebody with more than one, defaulting to theirs', async () => {
      const fixture = await render({
        profiles: [
          profile('p1', { name: 'Weekday' }),
          profile('p2', { name: 'Big shop', isDefault: true, position: 1 }),
        ],
      });

      expect(fixture.componentInstance.showProfiles()).toBe(true);
      expect(query(fixture, '.profile-select')).not.toBeNull();
      // The default profile and not the first in the list, which are different rows
      // here on purpose.
      expect(fixture.componentInstance.selectedProfileId()).toBe('p2');
    });
  });

  /**
   * Prefilling the tree from the profile's stored scope (plan 0049, section 3).
   *
   * The scope is read through its **own** call and never off the profile, which is why
   * every case here is stated on the service double rather than as a field on a
   * profile: a spec that could put it on the profile would be a spec proving the
   * hazard plan 0046 refused is back.
   */
  describe('the stored generation scope', () => {
    it('prechecks exactly what a SELECTED scope names', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
        scopes: {
          p1: {
            profileId: 'p1',
            scope: 'SELECTED',
            sources: [{ zoneId: 'z1', listId: 'l1' }],
          },
        },
        profiles: [profile('p1', { isDefault: true })],
      });

      await fixture.whenStable();

      // The named list, and nothing from the group the scope did not mention. That
      // second half is the one that breaks quietly: an unmentioned group defaults to
      // ticked, so without the prefill flipping that default the run would draw from a
      // household somebody had deliberately left out.
      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: 'l1' },
      ]);
    });

    /**
     * A `null` list id means the whole group **including lists made later**, which is
     * the `all` mode and not an enumeration of today's ids. Reading it as ticks would
     * send today's lists and quietly stop including new ones.
     */
    it('keeps a whole group stored as a group, not as its lists', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
        lists: { z1: [list('l1', 'Weekly shop'), list('l2', 'Costco run')] },
        scopes: {
          p1: {
            profileId: 'p1',
            scope: 'SELECTED',
            sources: [{ zoneId: 'z1', listId: null }],
          },
        },
        profiles: [profile('p1', { isDefault: true })],
      });

      await fixture.whenStable();

      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: null },
      ]);
      expect(fixture.componentInstance.zoneState('z1')).toBe('all');
    });

    // The default for somebody who has never narrowed anything, and the behaviour
    // this sheet shipped with.
    it('prechecks everything where the profile stores no scope', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
        profiles: [profile('p1', { isDefault: true })],
      });

      await fixture.whenStable();

      expect(scopeReads).toEqual(['p1']);
      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: null },
        { zoneId: 'z2', listId: null },
      ]);
    });

    it('prechecks everything for an ALL scope', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
        scopes: { p1: { profileId: 'p1', scope: 'ALL', sources: [] } },
        profiles: [profile('p1', { isDefault: true })],
      });

      await fixture.whenStable();

      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z1', listId: null },
        { zoneId: 'z2', listId: null },
      ]);
    });

    // The ticks belong to the profile, so switching reopens the tree on the new one's.
    it('re-reads when the profile changes', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
        profiles: [
          profile('p1', { isDefault: true }),
          profile('p2', { position: 1 }),
        ],
        scopes: {
          p2: {
            profileId: 'p2',
            scope: 'SELECTED',
            sources: [{ zoneId: 'z2', listId: null }],
          },
        },
      });

      await fixture.whenStable();

      fixture.componentInstance.onProfileChange({
        target: { value: 'p2' },
      } as unknown as Event);
      await fixture.whenStable();

      expect(scopeReads).toEqual(['p1', 'p2']);
      expect(fixture.componentInstance.sources()).toEqual([
        { zoneId: 'z2', listId: null },
      ]);
    });
  });

  /**
   * Somebody who is in groups but can write in none of them (plan 0049, section 4).
   *
   * This screen cannot know it on open without a `listLists` per group, so it says so
   * as the groups expand instead of leaving the person to infer it from an empty
   * expansion.
   */
  describe('in groups, writable nowhere', () => {
    it('says why once every expanded group has come back empty', async () => {
      const fixture = await render({
        // `READ` and nothing more, so the group has lists and none of them may feed a
        // run: the exact shape "member of zero groups" cannot detect.
        lists: { z1: [list('l1', 'Weekly shop', ['READ'])] },
      });

      expect(fixture.componentInstance.noSources()).toBe(false);
      expect(fixture.componentInstance.noWritableSources()).toBe(false);

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.noWritableSources()).toBe(true);
      expect(text(fixture)).toContain('getList.sources.noneWritable');
    });

    // One empty group among several says nothing about whether the run can draw from
    // anywhere, so the sentence waits until every expanded group has answered.
    it('stays quiet while another expanded group has writable lists', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: 'Home' })],
        lists: {
          z1: [list('l1', 'Weekly shop', ['READ'])],
          z2: [list('l2', 'Costco run')],
        },
      });

      fixture.componentInstance.toggleExpanded('z1');
      fixture.componentInstance.toggleExpanded('z2');
      await fixture.whenStable();

      expect(fixture.componentInstance.noWritableSources()).toBe(false);
    });
  });

  /**
   * A group with more than one page of writable lists (plan 0049, section 4).
   *
   * The sheet used to ask for one page of a hundred and stop, so the hundred and first
   * list was simply not there to be found. Silence was the defect rather than the
   * hundred.
   */
  describe('paging through a group s lists', () => {
    it('follows the cursor rather than showing the first page', async () => {
      const fixture = await render({
        pageSize: 2,
        lists: {
          z1: [
            list('l1', 'Weekly shop'),
            list('l2', 'Costco run'),
            list('l3', 'Chemist'),
          ],
        },
      });

      fixture.componentInstance.toggleExpanded('z1');
      await fixture.whenStable();

      expect(fixture.componentInstance.listsOf('z1')?.lists).toHaveLength(3);
      // Two pages asked for, the second carrying back the cursor the first answered.
      expect(listPages).toEqual([
        { zoneId: 'z1', cursor: null },
        { zoneId: 'z1', cursor: '2' },
      ]);
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
