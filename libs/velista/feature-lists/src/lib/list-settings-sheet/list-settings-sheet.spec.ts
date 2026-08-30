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
    sharedWithZone: false,
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

  describe('saving access (plan 0036, section 3)', () => {
    it('sends only the rows somebody edited, and never a staff row', async () => {
      // **The defect.** The sheet used to send `_access()` in full, staff rows
      // included, and backend plan 0036 rule 2 refuses any entry naming a group OWNER
      // or ADMIN, so the whole save failed on the first one and nothing was written.
      // Marc is an ADMIN of this group and Ana's row is untouched: neither may appear.
      const { fixture, saved } = await render({
        myRole: 'OWNER',
        access: [
          { membershipId: 'm-ana', permissions: ['READ', 'WRITE'] },
          { membershipId: 'm-marc', permissions: ['READ', 'WRITE', 'DECIDE'] },
        ],
      });

      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ', 'WRITE'],
      });
      await fixture.componentInstance.save();

      expect(saved.at(-1)).toEqual([
        { membershipId: 'm-toni', permissions: ['READ', 'WRITE'] },
      ]);
    });

    it('still sends an empty set, because that is how access is revoked', async () => {
      // An empty set is a deliberate instruction and never "no change": it is how the
      // same call revokes (backend plan 0036, section 5, rule 5). What changed is only
      // that an *untouched* row is no longer an edit.
      const { fixture, saved } = await render({
        myRole: 'OWNER',
        access: [{ membershipId: 'm-ana', permissions: ['READ', 'WRITE'] }],
      });

      fixture.componentInstance.changeAccess({
        membershipId: 'm-ana',
        permissions: [],
      });
      await fixture.componentInstance.save();

      expect(saved.at(-1)).toEqual([
        { membershipId: 'm-ana', permissions: [] },
      ]);
    });

    it('drops a row edited back to where it started', async () => {
      // Otherwise opening a row, ticking a box and unticking it sends an entry that
      // says nothing, and against a staff row that nothing is a 403.
      const { fixture, saved } = await render({
        myRole: 'OWNER',
        access: [{ membershipId: 'm-toni', permissions: ['READ'] }],
      });

      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ', 'WRITE'],
      });
      expect(fixture.componentInstance.hasAccessEdits()).toBe(true);

      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ'],
      });

      expect(fixture.componentInstance.hasAccessEdits()).toBe(false);
      expect(fixture.componentInstance.canSave()).toBe(false);
      await fixture.componentInstance.save();
      expect(saved).toEqual([]);
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
      await fixture.componentInstance.save();

      expect(saved.at(-1)).toEqual([
        { membershipId: 'm-toni', permissions: ['READ', 'DECIDE'] },
      ]);
    });

    it('marks an edited row rather than leaving it open', async () => {
      const { fixture } = await render({ myRole: 'OWNER' });

      expect(rowFor(fixture, 'm-toni').edited).toBe(false);
      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ'],
      });

      expect(rowFor(fixture, 'm-toni').edited).toBe(true);
    });
  });

  describe('the footer (plan 0036, section 4)', () => {
    it('holds Save and Cancel, and holds them outside the body', async () => {
      // A DOM assertion about where the buttons live rather than a visual one: they
      // were ordinary elements at the end of a scrolling panel, so with more than about
      // four members the primary action was off screen and had to be hunted for.
      const { fixture } = await render({ myRole: 'OWNER' });
      const host = fixture.nativeElement as HTMLElement;
      const footer = host.querySelector('.footer');

      expect(footer).not.toBeNull();
      expect(footer?.querySelector('.primary')).not.toBeNull();
      expect(footer?.querySelector('.cancel')).not.toBeNull();
      // Exactly one Save in the sheet, not one per section.
      expect(host.querySelectorAll('.primary')).toHaveLength(1);
      expect(host.querySelectorAll('.secondary')).toHaveLength(0);
    });

    it('keeps deleting in the body, out of reach of Cancel', async () => {
      // A destructive action beside Cancel is how somebody deletes a list they meant to
      // close.
      const { fixture } = await render({ myRole: 'OWNER' });
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('.danger')).not.toBeNull();
      expect(host.querySelector('.footer .danger')).toBeNull();
    });

    it('draws the member list with no scroll region of its own', async () => {
      // One scroll in the sheet, and it is the panel's. A nested scroll inside a sheet
      // that also scrolls has no good gesture on a phone.
      const { fixture } = await render({ myRole: 'OWNER' });
      const share = (fixture.nativeElement as HTMLElement).querySelector(
        '.share'
      ) as HTMLElement;

      expect(share).not.toBeNull();
      expect(getComputedStyle(share).overflowY).not.toBe('auto');
    });
  });

  describe('one Save, two requests (plan 0036, section 4.1)', () => {
    it('is disabled when nothing is pending', async () => {
      const { fixture } = await render({ myRole: 'OWNER' });

      expect(fixture.componentInstance.canSave()).toBe(false);
    });

    it('sends both when both changed, and each carries only its own fields', async () => {
      // The split into requests survives untouched: the gateway validates with
      // `forbidNonWhitelisted`, so a body carrying every field would let a rename
      // overwrite a setting somebody else had just changed.
      const { fixture, updates, saved } = await render({ myRole: 'OWNER' });

      fixture.componentInstance.name.set('Sunday shop');
      fixture.componentInstance.changeAccess({
        membershipId: 'm-toni',
        permissions: ['READ'],
      });
      await fixture.componentInstance.save();

      expect(updates).toEqual([{ name: 'Sunday shop' }]);
      expect(saved.at(-1)).toEqual([
        { membershipId: 'm-toni', permissions: ['READ'] },
      ]);
    });
  });

  describe('shared with the group (plan 0036, section 7)', () => {
    it('opens showing whether the list is shared', async () => {
      const { fixture } = await render({
        list: list({ sharedWithZone: true }),
      });

      expect(fixture.componentInstance.sharedWithZone()).toBe(true);
    });

    it('saves on the flip, sending only that field', async () => {
      const { fixture, updates } = await render();

      await fixture.componentInstance.setSharedWithZone({
        target: { checked: true },
      } as unknown as Event);

      expect(updates).toEqual([{ sharedWithZone: true }]);
      expect(fixture.componentInstance.sharedWithZone()).toBe(true);
    });

    it('turning it off is a save of its own and revokes nothing here', async () => {
      // Revoking is the server's answer and it revokes nobody (backend plan 0042,
      // section 2.2). What matters on this side is that the sheet sends the flag and
      // does not quietly rewrite anybody's row while doing it.
      const { fixture, updates, saved } = await render({
        list: list({ sharedWithZone: true }),
      });

      await fixture.componentInstance.setSharedWithZone({
        target: { checked: false },
      } as unknown as Event);

      expect(updates).toEqual([{ sharedWithZone: false }]);
      expect(saved).toEqual([]);
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
      await fixture.componentInstance.save();

      expect(updates).toEqual([{ name: 'Sunday shop' }]);
    });
  });
});
