import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeZoneStore,
  LIST_SERVICE,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeZoneStore,
  type ListServiceI,
} from '@portfolio/velista/data-access';
import type {
  ListAccessEntry,
  Membership,
  MyZone,
  ShareRowVm,
  ShoppingListSummary,
  UpdateListRequest,
  ZoneRole,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ListSettingsSheet } from './list-settings-sheet';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const CREATOR = 'user-ana';

/**
 * Plan 0030, sections 6.1.1, 6.3 and 6.5, and acceptance items 8, 9 and 10.
 *
 * `shareRows` is the half of the share sheet that decides which rule produced a row, and
 * it is where acceptance item 9's two callers actually differ: the row component renders
 * `lockedPermissions` without knowing what filled it, so a spec against the component
 * alone cannot tell a group admin's sheet from a list admin's. This is that spec.
 */
function zone(myRole: ZoneRole): MyZone {
  return {
    id: ZONE_ID,
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'user-owner',
    myRole,
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 1,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

function member(
  id: string,
  userId: string,
  username: string,
  role: ZoneRole
): Membership {
  return { id, zoneId: ZONE_ID, userId, username, role, status: 'APPROVED' };
}

const MEMBERS: readonly Membership[] = [
  member('m-ana', CREATOR, 'Ana', 'MEMBER'),
  member('m-marc', 'user-marc', 'Marc', 'ADMIN'),
  member('m-toni', 'user-toni', 'Toni', 'MEMBER'),
];

function list(
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: CREATOR,
    autoApproveLines: false,
    lineCount: 0,
    readyCount: 0,
    myPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
    ...overrides,
  };
}

interface Options {
  /** The **caller's** role in the group, which is what gates the MANAGE box. */
  readonly myRole?: ZoneRole;
  readonly list?: ShoppingListSummary;
  readonly access?: readonly ListAccessEntry[];
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ListSettingsSheet>;
  updates: UpdateListRequest[];
  saved: (readonly ListAccessEntry[])[];
}> {
  TestBed.resetTestingModule();

  const updates: UpdateListRequest[] = [];
  const saved: (readonly ListAccessEntry[])[] = [];

  const service = {
    getListAccess: async () => options.access ?? [],
    updateList: async (_listId: string, changes: UpdateListRequest) => {
      updates.push(changes);
      return list();
    },
    setListAccess: async (
      _listId: string,
      entries: readonly ListAccessEntry[]
    ) => {
      saved.push(entries);
      return list();
    },
    deleteList: async () => LIST_ID,
  } as unknown as ListServiceI;

  const map = convertToParamMap({ zoneId: ZONE_ID, listId: LIST_ID });

  await TestBed.configureTestingModule({
    imports: [ListSettingsSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeZoneStore(
        fakeZoneStore({ zones: [zone(options.myRole ?? 'MEMBER')] })
      ),
      provideFakeListStore(
        fakeListStore({ lists: [options.list ?? list()], state: 'loaded' })
      ),
      provideFakeLineStore(fakeLineStore({ lines: [], state: 'loaded' })),
      provideFakeMemberNames(fakeMemberNames({}, MEMBERS)),
      { provide: LIST_SERVICE, useValue: service },
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListSettingsSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, updates, saved };
}

function rowFor(
  fixture: ComponentFixture<ListSettingsSheet>,
  membershipId: string
): ShareRowVm {
  const found = fixture.componentInstance
    .shareRows()
    .find((row) => row.membershipId === membershipId);

  if (found === undefined) {
    throw new Error(`no row for ${membershipId}`);
  }
  return found;
}

describe('ListSettingsSheet', () => {
  it('offers the share section, at last', async () => {
    // `GET /v1/lists/:id/access` exists, so the sheet can send a complete set knowing
    // what it replaces, which is the one thing plan 0012 switched this off for.
    const { fixture } = await render();

    expect(fixture.componentInstance.shareAvailable).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('list.settings.share');
  });

  describe('who is fixed and what is locked (section 6.3)', () => {
    it('fixes a group admin, fully ticked, with the corrected note', async () => {
      // Group admins hold all four on every list in the zone by derivation, so there is
      // no stored row to rewrite (backend plan 0036, section 2.4).
      const { fixture } = await render({ myRole: 'ADMIN' });

      expect(rowFor(fixture, 'm-marc')).toMatchObject({
        permissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
        lockedPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
        fixed: true,
        fixedReasonKey: 'list.settings.access.staffNote',
      });
    });

    it('fixes them for a list admin who is not staff, too', async () => {
      // The row is fixed for everybody, because for everybody the answer is the same
      // and the server refuses it identically (backend plan 0036, section 5, rule 2).
      const { fixture } = await render({ myRole: 'MEMBER' });

      expect(rowFor(fixture, 'm-marc').fixed).toBe(true);
    });

    it('leaves every List admin box live for a group admin', async () => {
      // Acceptance item 9, first half, the creator's row included.
      const { fixture } = await render({ myRole: 'OWNER' });

      expect(rowFor(fixture, 'm-toni').lockedPermissions).toEqual([]);
      expect(rowFor(fixture, 'm-ana').lockedPermissions).toEqual([]);
    });

    it('locks only MANAGE for a list admin who is not staff', async () => {
      // Acceptance item 9, second half: the other three boxes on the same rows stay
      // live, and only the group appoints list admins (backend plan 0036, section 5.1).
      const { fixture } = await render({ myRole: 'MEMBER' });

      expect(rowFor(fixture, 'm-toni')).toMatchObject({
        lockedPermissions: ['MANAGE'],
        fixed: false,
        fixedReasonKey: 'list.settings.access.manageLocked',
      });
    });

    it('makes the creator an ordinary row', async () => {
      // No longer fixed: their power is a stored access row a group admin can rewrite,
      // MANAGE included (backend plan 0036, section 2.5).
      const { fixture } = await render({
        myRole: 'OWNER',
        access: [
          { membershipId: 'm-ana', permissions: ['READ', 'WRITE', 'MANAGE'] },
        ],
      });

      expect(rowFor(fixture, 'm-ana')).toMatchObject({
        permissions: ['READ', 'WRITE', 'MANAGE'],
        fixed: false,
        fixedReasonKey: null,
      });
      expect(fixture.componentInstance.isCreator('m-ana')).toBe(true);
      expect(fixture.componentInstance.isCreator('m-toni')).toBe(false);
    });

    it('reads no access at all as the empty set, not as a missing row', async () => {
      const { fixture } = await render({ myRole: 'OWNER' });

      expect(rowFor(fixture, 'm-toni').permissions).toEqual([]);
    });
  });

  describe('saving access', () => {
    it('sends the whole set for every row it holds, revocations included', async () => {
      // An empty set is a deliberate instruction and never "no change": it is how the
      // same call revokes (backend plan 0036, section 5, rule 5).
      const { fixture, saved } = await render({ myRole: 'OWNER' });

      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ', 'WRITE'],
      });
      fixture.componentInstance.changeAccess({
        membershipId: 'm-ana',
        permissions: [],
      });
      await fixture.componentInstance.saveAccess();

      expect(saved.at(-1)).toEqual([
        { membershipId: 'm-toni', permissions: ['READ', 'WRITE'] },
        { membershipId: 'm-ana', permissions: [] },
      ]);
    });

    it('replaces a row rather than accumulating two answers for it', async () => {
      const { fixture, saved } = await render({ myRole: 'OWNER' });

      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ'],
      });
      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ', 'DECIDE'],
      });
      await fixture.componentInstance.saveAccess();

      expect(saved.at(-1)).toEqual([
        { membershipId: 'm-toni', permissions: ['READ', 'DECIDE'] },
      ]);
    });
  });

  describe('the auto-approve switch (section 6.5)', () => {
    it('opens showing the list configuration', async () => {
      const { fixture } = await render({
        list: list({ autoApproveLines: true }),
      });

      expect(fixture.componentInstance.autoApprove()).toBe(true);
    });

    it('sends only that field, so a rename cannot ride along', async () => {
      // Acceptance item 10. The gateway validates with `forbidNonWhitelisted` and the
      // body carries only what it names, so the two controls cannot overwrite each
      // other's setting.
      const { fixture, updates } = await render();

      await fixture.componentInstance.setAutoApprove({
        target: { checked: true },
      } as unknown as Event);

      expect(updates).toEqual([{ autoApproveLines: true }]);
      expect(fixture.componentInstance.autoApprove()).toBe(true);
    });

    it('sends only the name when the name is what changed', async () => {
      const { fixture, updates } = await render();

      fixture.componentInstance.name.set('Sunday shop');
      await fixture.componentInstance.rename();

      expect(updates).toEqual([{ name: 'Sunday shop' }]);
    });
  });
});
