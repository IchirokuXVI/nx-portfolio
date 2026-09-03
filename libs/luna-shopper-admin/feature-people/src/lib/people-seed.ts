import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Rows for the people screens with nothing listening.
 *
 * Every data domain in this workspace ships an in-memory implementation, and a
 * descriptor gets one by naming a seed. What is peculiar here is that the rows
 * are the **detail** shape rather than the list shape: the memory gateway keeps
 * one table per path and serves both reads out of it, so seeding the richer
 * shape means opening a row in this mode shows its members, its lists or its
 * lines instead of an empty section. The list ignores the extra properties.
 *
 * The fixture is not neutral. It contains, on purpose:
 *
 * - **Two accounts with the same username.** `username` is the global handle and
 *   is not unique, so two identical ones are an ordinary result rather than a
 *   bug, and a screen that keyed rows by it would collapse them (plan 0007,
 *   section 2).
 * - **A zone whose owner cannot be resolved.** `ownerName` is null there, which
 *   is what the gateway answers when the second call to auth found nobody. The
 *   list renders the id and does not fail (plan 0007, section 4).
 * - **A zone with no owner at all**, which is a real state: the owner deleted
 *   their account, and transferring ownership is what rescues it.
 */

const ROSA = '11111111-1111-4111-8111-111111111111';
const MARC = '22222222-2222-4222-8222-222222222222';
const ROSA_AGAIN = '33333333-3333-4333-8333-333333333333';
const GUEST = '44444444-4444-4444-8444-444444444444';
const REAPED = '99999999-9999-4999-8999-999999999999';

const KITCHEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALLOTMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** A user, as both the listing and the detail read describe one. */
export type UserRow = Wire.AdminUsersAdminUserDetailView;

/** A zone row, carrying everything the detail read adds to the listing. */
export type ZoneRow = Wire.AdminCoreAdminZoneRowView &
  Wire.AdminCoreAdminZoneDetailView;

export type ListRow = Wire.AdminCoreAdminListDetailView;

export type BasketRow = Wire.AdminCoreAdminBasketDetailView;

export type AdminRow = Wire.AdminAuthAdminIdentityView;

export const USER_SEED: readonly UserRow[] = [
  {
    userId: ROSA,
    kind: 'REGISTERED',
    username: 'rosa',
    displayName: 'Rosa Iglesias',
    email: 'rosa@example.com',
    emailVerifiedAt: '2026-01-14T09:12:00.000Z',
    createdAt: '2026-01-12T18:40:00.000Z',
    updatedAt: '2026-06-02T11:05:00.000Z',
    hasPassword: true,
    providers: ['EMAIL'],
  },
  {
    userId: MARC,
    kind: 'REGISTERED',
    username: 'marc',
    displayName: 'Marc Oliver',
    email: 'marc@example.com',
    emailVerifiedAt: null,
    createdAt: '2026-03-03T08:00:00.000Z',
    updatedAt: '2026-03-03T08:00:00.000Z',
    hasPassword: false,
    providers: ['GOOGLE'],
  },
  // The same handle as the first row, and a different person. Nothing about
  // this is an error state.
  {
    userId: ROSA_AGAIN,
    kind: 'REGISTERED',
    username: 'rosa',
    displayName: null,
    email: 'rosa.b@example.com',
    emailVerifiedAt: '2026-05-20T16:30:00.000Z',
    createdAt: '2026-05-20T16:22:00.000Z',
    updatedAt: '2026-05-20T16:30:00.000Z',
    hasPassword: true,
    providers: ['EMAIL'],
  },
  {
    userId: GUEST,
    kind: 'TEMPORARY',
    username: 'guest-4f2a',
    displayName: null,
    email: null,
    emailVerifiedAt: null,
    createdAt: '2026-08-30T20:15:00.000Z',
    updatedAt: '2026-08-30T20:15:00.000Z',
    hasPassword: false,
    providers: [],
  },
];

export const ZONE_SEED: readonly ZoneRow[] = [
  {
    id: KITCHEN,
    name: 'Kitchen',
    status: 'ACTIVE',
    ownerUserId: ROSA,
    ownerName: 'rosa',
    memberCount: 3,
    listCount: 2,
    markedForDeletionAt: null,
    createdAt: '2026-01-12T19:02:00.000Z',
    updatedAt: '2026-08-28T07:44:00.000Z',
    joinCode: 'K4TCH2N9',
    config: {},
    members: [
      {
        membershipId: 'm-kitchen-rosa',
        userId: ROSA,
        username: 'rosa',
        role: 'OWNER',
        status: 'APPROVED',
        createdAt: '2026-01-12T19:02:00.000Z',
      },
      {
        membershipId: 'm-kitchen-marc',
        userId: MARC,
        username: 'marc',
        role: 'MEMBER',
        status: 'APPROVED',
        createdAt: '2026-03-03T09:10:00.000Z',
      },
      {
        membershipId: 'm-kitchen-guest',
        userId: GUEST,
        username: 'guest-4f2a',
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: '2026-08-30T20:16:00.000Z',
      },
    ],
    lists: [
      { id: 'l-kitchen-weekly', name: 'Weekly shop', lineCount: 12 },
      { id: 'l-kitchen-party', name: 'Party', lineCount: 4 },
    ],
  },
  // Ownerless, and its owner id resolves to nobody: the account was deleted and
  // the zone outlived it. Both halves of that are what the screen has to draw.
  {
    id: ALLOTMENT,
    name: 'Allotment',
    status: 'MARKED_FOR_DELETION',
    ownerUserId: REAPED,
    ownerName: null,
    memberCount: 1,
    listCount: 1,
    markedForDeletionAt: '2026-08-31T10:00:00.000Z',
    createdAt: '2026-02-01T12:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    joinCode: 'ALL0TM3N',
    config: {},
    members: [
      {
        membershipId: 'm-allotment-marc',
        userId: MARC,
        username: 'marc',
        role: 'ADMIN',
        status: 'APPROVED',
        createdAt: '2026-02-01T12:04:00.000Z',
      },
    ],
    lists: [{ id: 'l-allotment-seeds', name: 'Seeds', lineCount: 3 }],
  },
];

export const LIST_SEED: readonly ListRow[] = [
  {
    id: 'l-kitchen-weekly',
    zoneId: KITCHEN,
    zoneName: 'Kitchen',
    name: 'Weekly shop',
    createdByUserId: ROSA,
    autoApproveLines: true,
    sharedWithZone: true,
    lineCount: 3,
    createdAt: '2026-01-13T08:00:00.000Z',
    updatedAt: '2026-08-28T07:44:00.000Z',
    lines: [
      {
        id: 'line-milk',
        content: 'Milk, two litres',
        quantity: 2,
        approvalStatus: 'APPROVED',
        createdByUserId: ROSA,
        createdAt: '2026-08-27T18:00:00.000Z',
        updatedAt: '2026-08-27T18:00:00.000Z',
      },
      {
        id: 'line-bread',
        content: 'Bread',
        quantity: 1,
        approvalStatus: 'APPROVED',
        createdByUserId: MARC,
        createdAt: '2026-08-27T18:02:00.000Z',
        updatedAt: '2026-08-27T18:02:00.000Z',
      },
      {
        id: 'line-olives',
        content: 'Olives',
        quantity: 1,
        approvalStatus: 'PENDING',
        createdByUserId: GUEST,
        createdAt: '2026-08-30T20:20:00.000Z',
        updatedAt: '2026-08-30T20:20:00.000Z',
      },
    ],
  },
  {
    id: 'l-allotment-seeds',
    zoneId: ALLOTMENT,
    zoneName: 'Allotment',
    name: 'Seeds',
    createdByUserId: MARC,
    autoApproveLines: false,
    sharedWithZone: false,
    lineCount: 1,
    createdAt: '2026-02-01T12:10:00.000Z',
    updatedAt: '2026-02-01T12:10:00.000Z',
    lines: [
      {
        id: 'line-tomato',
        content: 'Tomato seeds',
        quantity: 3,
        approvalStatus: 'APPROVED',
        createdByUserId: MARC,
        createdAt: '2026-02-01T12:10:00.000Z',
        updatedAt: '2026-02-01T12:10:00.000Z',
      },
    ],
  },
];

export const BASKET_SEED: readonly BasketRow[] = [
  {
    id: 'b-saturday',
    ownerUserId: ROSA,
    name: 'Saturday',
    status: 'DRAFT',
    zoneIds: [KITCHEN],
    lineCount: 2,
    generatedAt: '2026-08-29T09:00:00.000Z',
    createdAt: '2026-08-29T09:00:00.000Z',
    updatedAt: '2026-08-29T09:30:00.000Z',
    lines: [
      {
        id: 'bline-milk',
        content: 'Milk, two litres',
        quantity: 2,
        createdAt: '2026-08-29T09:00:00.000Z',
      },
      {
        id: 'bline-bread',
        content: 'Bread',
        quantity: 1,
        createdAt: '2026-08-29T09:00:00.000Z',
      },
    ],
  },
  {
    id: 'b-allotment',
    ownerUserId: MARC,
    name: null,
    status: 'COMPLETED',
    zoneIds: [ALLOTMENT],
    lineCount: 1,
    generatedAt: '2026-02-02T10:00:00.000Z',
    createdAt: '2026-02-02T10:00:00.000Z',
    updatedAt: '2026-02-02T11:20:00.000Z',
    lines: [
      {
        id: 'bline-tomato',
        content: 'Tomato seeds',
        quantity: 3,
        createdAt: '2026-02-02T10:00:00.000Z',
      },
    ],
  },
];

export const ADMIN_SEED: readonly AdminRow[] = [
  {
    adminId: 'admin-ichiroku',
    username: 'ichiroku',
    displayName: 'Ichiroku',
    lastLoginAt: '2026-09-02T07:30:00.000Z',
    disabledAt: null,
  },
  {
    adminId: 'admin-retired',
    username: 'retired',
    displayName: null,
    lastLoginAt: '2026-04-11T15:00:00.000Z',
    disabledAt: '2026-05-01T00:00:00.000Z',
  },
];
