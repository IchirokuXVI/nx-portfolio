import { computed, signal, type Provider } from '@angular/core';
import type {
  Identity,
  Membership,
  MembershipStatus,
  MyZone,
  SessionTokens,
  ShoppingListSummary,
  UserKind,
} from '@portfolio/velista/models';
import { AccountNotice } from '../auth/account-notice';
import {
  AUTH_SERVICE,
  type AuthServiceI,
  type ResendOutcome,
  type VerifiedEmail,
} from '../auth/auth-service';
import { SessionStore } from '../auth/session-store';
import { ListStore, type ListLoadState } from '../lists/list-store';
import {
  MEMBERSHIP_SERVICE,
  type MembershipServiceI,
} from '../memberships/membership-service';
import {
  ZoneStore,
  type ZoneDeparture,
  type ZoneEntry,
  type ZoneEntryOutcome,
  type ZoneLoadState,
  type ZoneWriteOutcome,
} from '../zones/zone-store';

/**
 * Stand-ins for the two stores a page container injects.
 *
 * ## Why a page spec wants these
 *
 * `ZoneStore` is a real object with real behaviour: it checks whether the caller is
 * authenticated, calls `ZONE_SERVICE`, applies realtime events and books rooms. A page
 * spec that uses the real one has to build a whole `ZoneServiceI`, a whole
 * `SessionStore` and a realtime client just to get a card on screen, and then has to
 * drive the store to a state before it can assert anything. That is a data layer test
 * wearing a page test's clothes.
 *
 * Worse, it does not compose with how the page actually starts. `HomePage`'s
 * constructor calls `void this._zoneStore.load()` and discards the promise, so a spec
 * has no handle on the load the component itself began. `home-page.spec.ts` used to
 * work around that by calling `TestBed.inject(ZoneStore).load()` a **second** time
 * purely to get something to await. That ran every fetch twice, awaited a promise that
 * was not the one the page was waiting on, and tied the page's spec to the store's
 * method names and to the fact that loading twice happens to be safe. Give the page a
 * store that is already in the state under test and all of it goes away.
 *
 * The real store keeps its own spec (`zone-store.spec.ts`), which is where that
 * behaviour belongs.
 *
 * ## Why this does not need a `ZoneStoreI` interface
 *
 * Angular substitutes a class token as readily as an interface token, so
 * `{ provide: ZoneStore, useValue: ... }` works without a single production change.
 * Adding an interface to make a test seam possible would be paying in production code
 * for something the injector already gives away (plan `0005`, section 5).
 */

/** The state a faked `ZoneStore` should present. */
export interface FakeZoneStateOptions {
  readonly zones?: readonly MyZone[];
  readonly state?: ZoneLoadState;
  readonly error?: unknown;
  readonly staleZoneIds?: ReadonlySet<string>;
  /** The way in just taken, which is what the dashboard reports once (plan 0008). */
  readonly lastEntry?: ZoneEntry | null;
  /**
   * What the two mutations answer.
   *
   * A function, so one fake can answer differently per call, which is what a sheet
   * spec that fixes a rejected code and asks again needs. The default succeeds.
   *
   * It may answer with a promise, and a promise that never settles is how a spec puts
   * a sheet into its submitting state and leaves it there: that state is defined by a
   * request being out, so anything else would be simulating it rather than reaching it.
   */
  readonly respond?: (
    call: ZoneMutationCall
  ) => ZoneEntryOutcome | Promise<ZoneEntryOutcome>;

  /** A zone the caller has just lost, for the page that has to leave and say why. */
  readonly departure?: ZoneDeparture | null;

  /** How the single-zone load is going. Defaults to `loaded` for every seeded zone. */
  readonly zoneState?: ZoneLoadState;

  /** What a governance write answers. The default succeeds. */
  readonly respondToWrite?: (call: ZoneWriteCall) => ZoneWriteOutcome;
}

/** One recorded call to a faked mutation. */
export type ZoneMutationCall =
  | { readonly method: 'createZone'; readonly name: string }
  | { readonly method: 'joinZone'; readonly joinCode: string };

/** One recorded governance write, or a count nudge that followed one (plan 0010). */
export type ZoneWriteCall =
  | {
      readonly method: 'renameZone';
      readonly zoneId: string;
      readonly name: string;
    }
  | { readonly method: 'regenerateJoinCode'; readonly zoneId: string }
  | { readonly method: 'deleteZone'; readonly zoneId: string }
  | { readonly method: 'claimOwnership'; readonly zoneId: string }
  | {
      readonly method: 'recordMembershipChange';
      readonly zoneId: string;
      readonly change: 'approved' | 'rejected' | 'removed';
    };

/**
 * A `ZoneStore` that is simply in the state you asked for.
 *
 * `load` is a resolved promise that records the call, so a spec can still assert that
 * retrying asks for the data again, which is the only thing about loading a page test
 * legitimately cares about.
 */
export function fakeZoneStore(options: FakeZoneStateOptions = {}) {
  const zones = signal<readonly MyZone[]>(options.zones ?? []);
  const state = signal<ZoneLoadState>(options.state ?? 'loaded');
  const error = signal<unknown>(options.error ?? null);
  const loads = signal(0);
  const lastEntry = signal<ZoneEntry | null>(options.lastEntry ?? null);
  const departure = signal<ZoneDeparture | null>(options.departure ?? null);

  /**
   * How the load of each individual zone is going (plan 0010).
   *
   * Defaults to `loaded` for every zone the fake was seeded with, and to whatever
   * `zoneState` names otherwise, so a spec that just wants a group on screen says
   * nothing and a spec about a cold deep link says `{ zoneState: 'loading' }`.
   */
  const zoneStates = signal<ReadonlyMap<string, ZoneLoadState>>(
    new Map(
      (options.zones ?? []).map((zone) => [
        zone.id,
        options.zoneState ?? 'loaded',
      ])
    )
  );

  /** Every governance write asked for, in order, so a spec can assert what was sent. */
  const writes: ZoneWriteCall[] = [];

  const writeOutcome = options.respondToWrite;

  /** Every mutation asked for, in order, so a spec can assert what was sent. */
  const calls: {
    method: 'createZone' | 'joinZone';
    name?: string;
    joinCode?: string;
  }[] = [];

  const respond =
    options.respond ??
    ((call: ZoneMutationCall): ZoneEntryOutcome =>
      call.method === 'createZone'
        ? { state: 'created', zoneId: 'zone-new' }
        : { state: 'joined', zoneId: 'zone-joined' });

  /** Records a governance write and answers however the spec asked. */
  function record(call: ZoneWriteCall): ZoneWriteOutcome {
    writes.push(call);
    return writeOutcome?.(call) ?? { state: 'succeeded' };
  }

  return {
    myZones: zones.asReadonly(),
    state: state.asReadonly(),
    error: error.asReadonly(),
    staleZoneIds: computed(() => options.staleZoneIds ?? new Set<string>()),
    lastEntry: lastEntry.asReadonly(),

    /** How many times the page asked for a load. Starts at one after a render. */
    loadCount: loads.asReadonly(),

    /** What the page asked the store to write. */
    mutations: calls as readonly {
      readonly method: 'createZone' | 'joinZone';
      readonly name?: string;
      readonly joinCode?: string;
    }[],

    load: async () => {
      loads.update((count) => count + 1);
    },
    upsert: (zone: MyZone) => zones.update((current) => [zone, ...current]),

    createZone: async (name: string): Promise<ZoneEntryOutcome> => {
      calls.push({ method: 'createZone', name });
      return respond({ method: 'createZone', name });
    },
    joinZone: async (joinCode: string): Promise<ZoneEntryOutcome> => {
      calls.push({ method: 'joinZone', joinCode });
      return respond({ method: 'joinZone', joinCode });
    },
    clearLastEntry: () => lastEntry.set(null),

    /** Put a page into the state it would be in straight after a way in. */
    setLastEntry: (entry: ZoneEntry | null) => lastEntry.set(entry),

    // ---------------------------------------------------------- plan 0010
    //
    // The group page and the members screen read one zone rather than the list, and
    // both write to it. The same argument as above applies twice over: driving the
    // real store to "an admin looking at an ownerless group" means a service, a
    // session, a realtime client and four calls, and the page spec is not about any
    // of that.

    zoneById: (zoneId: string) => zones().find((zone) => zone.id === zoneId),

    zoneState: zoneStates.asReadonly(),

    departure: departure.asReadonly(),
    clearDeparture: () => departure.set(null),

    /** Drive a live removal or deletion at a page that is already mounted. */
    setDeparture: (next: ZoneDeparture | null) => departure.set(next),

    /**
     * Reads one zone, and writes what it read back into the cache.
     *
     * The write is the point. The real store upserts whatever `getZone` answered, so
     * every reload hands out a fresh cache signal even when the group came back
     * unchanged, and a page effect that both calls this and reads the cache schedules
     * itself again on its own request. A double that only moved `zoneState` could not
     * reproduce that, and did not: the loop it hides is one `GET /v1/zones/{id}` per
     * frame for as long as the screen is open.
     *
     * The `await` before it matters as much as the write. The real store writes what
     * the request answered, which is a microtask later at the earliest, and a signal
     * written **during** an effect and read after it leaves that effect clean. A
     * double that wrote synchronously would therefore look innocent while shipping the
     * loop.
     */
    loadZone: async (zoneId: string) => {
      loads.update((count) => count + 1);
      zoneStates.update((current) => new Map(current).set(zoneId, 'loaded'));

      await Promise.resolve();
      zones.update((current) =>
        current.map((zone) => (zone.id === zoneId ? { ...zone } : zone))
      );
    },

    /** What the page asked the store to write to the zone itself. */
    writes: writes as readonly ZoneWriteCall[],

    renameZone: async (zoneId: string, name: string) =>
      record({ method: 'renameZone', zoneId, name }),
    regenerateJoinCode: async (zoneId: string) =>
      record({ method: 'regenerateJoinCode', zoneId }),
    deleteZone: async (zoneId: string) =>
      record({ method: 'deleteZone', zoneId }),
    claimOwnership: async (zoneId: string) =>
      record({ method: 'claimOwnership', zoneId }),

    recordMembershipChange: (
      zoneId: string,
      change: 'approved' | 'rejected' | 'removed'
    ) => {
      writes.push({ method: 'recordMembershipChange', zoneId, change });
    },

    /** Move the store while a fixture is mounted, to test a live update. */
    set: (next: readonly MyZone[]) => zones.set(next),
    setState: (next: ZoneLoadState, cause: unknown = null) => {
      state.set(next);
      error.set(cause);
    },
  };
}

export type FakeZoneStore = ReturnType<typeof fakeZoneStore>;

/** {@link fakeZoneStore} bound to the real token. */
export function provideFakeZoneStore(store: FakeZoneStore): Provider {
  return { provide: ZoneStore, useValue: store };
}

/** Who the page thinks is looking at it. `anonymous` is a designed state, not an error. */
export type FakeIdentity = 'anonymous' | UserKind;

/**
 * A `SessionStore` reporting one identity.
 *
 * Built from the same `Identity` the real store computes, rather than from a bag of
 * loose booleans, so a spec cannot ask for a combination the real one never produces
 * (a guest who is not authenticated, say).
 */
export function fakeSessionStore(
  kind: FakeIdentity = 'REGISTERED',
  overrides: { userId?: string; username?: string | null } = {}
) {
  const userId = overrides.userId ?? 'u1';
  const username =
    overrides.username === undefined ? 'Dani' : overrides.username;

  const identity: Identity =
    kind === 'anonymous'
      ? { kind: 'anonymous' }
      : { kind, userId, username: username ?? '' };

  return {
    identity: () => identity,
    username: () => (kind === 'anonymous' || !username ? null : username),
    isAuthenticated: () => kind !== 'anonymous',
    isGuest: () => kind === 'TEMPORARY',
    userId: () => (kind === 'anonymous' ? null : userId),
  };
}

/** {@link fakeSessionStore} bound to the real token. */
export function provideFakeSessionStore(
  kind: FakeIdentity = 'REGISTERED',
  overrides?: { userId?: string; username?: string | null }
): Provider {
  return {
    provide: SessionStore,
    useValue: fakeSessionStore(kind, overrides),
  };
}

/**
 * A `SessionTokens` with the shape the app actually stores.
 *
 * Only `kind` and `userId` usually matter to a caller, so the rest is filled in rather
 * than asked for.
 */
function tokensFor(userId: string, kind: UserKind): SessionTokens {
  return {
    userId,
    kind,
    username: 'dani',
    accessToken: 'access',
    refreshToken: 'refresh',
  };
}

/** One recorded call to a faked auth service. */
export type AuthCall =
  | { readonly method: 'register'; readonly email: string }
  | { readonly method: 'login'; readonly email: string }
  | { readonly method: 'upgrade'; readonly email: string }
  | { readonly method: 'verifyEmail'; readonly token: string }
  | { readonly method: 'resendVerification' };

/** What a faked auth service does when asked. */
export interface FakeAuthOptions {
  /**
   * The user id every issued pair carries.
   *
   * One id for all three calls by default, because the property plan 0009 cares about
   * most is that upgrading keeps the caller's own. A spec that wants to prove register
   * does not keep it says so.
   */
  readonly userId?: string;

  /** What each call throws, if anything. Keyed by method, so one fake covers a form. */
  readonly rejectWith?: Partial<Record<AuthCall['method'], unknown>>;

  /** What a resend answers. The default is a send with a wait the server named. */
  readonly resend?: ResendOutcome;
}

/**
 * An `AuthServiceI` that records what it was asked and answers without a transport.
 *
 * The same reasoning as {@link fakeZoneStore}: a page spec using the real `AuthApi`
 * would be building an `HttpClient`, an interceptor and a token store to get a form on
 * screen, and would then be testing the transport rather than the page. `AuthApi` keeps
 * its own spec, which is where that behaviour belongs.
 */
export function fakeAuthService(options: FakeAuthOptions = {}) {
  const userId = options.userId ?? 'u1';
  const calls: AuthCall[] = [];

  const answer = (call: AuthCall, kind: UserKind): SessionTokens => {
    calls.push(call);
    const rejection = options.rejectWith?.[call.method];
    if (rejection !== undefined) {
      throw rejection;
    }

    return tokensFor(userId, kind);
  };

  const service: AuthServiceI = {
    register: async (email: string) =>
      answer({ method: 'register', email }, 'REGISTERED'),
    login: async (email: string) =>
      answer({ method: 'login', email }, 'REGISTERED'),
    upgrade: async (email: string) =>
      answer({ method: 'upgrade', email }, 'REGISTERED'),

    verifyEmail: async (token: string): Promise<VerifiedEmail> => {
      calls.push({ method: 'verifyEmail', token });
      const rejection = options.rejectWith?.['verifyEmail'];
      if (rejection !== undefined) {
        throw rejection;
      }

      return { userId };
    },

    resendVerification: async (): Promise<ResendOutcome> => {
      calls.push({ method: 'resendVerification' });
      return options.resend ?? { state: 'sent', waitSeconds: 52 };
    },
  };

  return {
    ...service,
    /** Everything the page asked for, in order. */
    calls: calls as readonly AuthCall[],
  };
}

export type FakeAuthService = ReturnType<typeof fakeAuthService>;

/** {@link fakeAuthService} bound to the real token. */
export function provideFakeAuthService(
  service: FakeAuthService = fakeAuthService()
): Provider {
  return { provide: AUTH_SERVICE, useValue: service };
}

/** How a faked `ListStore` should present one zone. */
export interface FakeListStateOptions {
  readonly lists?: readonly ShoppingListSummary[];
  readonly state?: ListLoadState;
  readonly error?: unknown;
}

/**
 * A `ListStore` that is simply in the state you asked for.
 *
 * `fakeZoneStore`'s reasoning, applied to the second store the group page injects. The
 * real one resolves `LIST_SERVICE`, subscribes to a realtime client and keys its cache
 * by zone, and a page spec that used it would be building all three to get three rows
 * on screen.
 *
 * `loadCount` is what an acceptance criterion actually turns on: a caller whose
 * membership is still PENDING must cause **no** request for the lists, and asserting
 * on the double is the only way to prove a request was not made (section 3.3).
 */
export function fakeListStore(options: FakeListStateOptions = {}) {
  const lists = signal<readonly ShoppingListSummary[]>(options.lists ?? []);
  const state = signal<ListLoadState>(options.state ?? 'loaded');
  const error = signal<unknown>(options.error ?? null);
  const loads = signal(0);

  const created: { zoneId: string; name: string }[] = [];

  return {
    /** How many times a page asked for this zone's lists. Starts at zero. */
    loadCount: loads.asReadonly(),

    /** Every list this page asked to create. */
    creations: created as readonly {
      readonly zoneId: string;
      readonly name: string;
    }[],

    listsIn: () => lists(),
    stateOf: () => state(),
    errorOf: () => error(),
    forZone: () =>
      computed(() => ({
        lists: lists(),
        state: state(),
        error: error(),
      })),

    load: async () => {
      loads.update((count) => count + 1);
    },
    refresh: async () => {
      loads.update((count) => count + 1);
    },

    createList: async (zoneId: string, name: string) => {
      created.push({ zoneId, name });
      const list: ShoppingListSummary = {
        id: 'list-new',
        zoneId,
        name,
        createdByUserId: 'u1',
        lineCount: 0,
        readyCount: 0,
      };
      lists.update((current) => [list, ...current]);
      return { state: 'created' as const, list };
    },

    /** Move the store while a fixture is mounted, to test a live update. */
    set: (next: readonly ShoppingListSummary[]) => lists.set(next),
    setState: (next: ListLoadState, cause: unknown = null) => {
      state.set(next);
      error.set(cause);
    },
  };
}

export type FakeListStore = ReturnType<typeof fakeListStore>;

/** {@link fakeListStore} bound to the real token. */
export function provideFakeListStore(store: FakeListStore): Provider {
  return { provide: ListStore, useValue: store };
}

/** One recorded call to a faked membership service. */
export interface MembershipCall {
  readonly method:
    | 'listMembers'
    | 'approve'
    | 'reject'
    | 'kick'
    | 'ban'
    | 'setRole'
    | 'transferOwnership'
    | 'setUsername';
  readonly zoneId: string;
  readonly membershipId?: string;
  /** What `listMembers` was asked for, which is where rule G2 is observable. */
  readonly statuses?: readonly MembershipStatus[];
  readonly role?: string;
  readonly username?: string;
}

/** What a faked membership service does when asked. */
export interface FakeMembershipOptions {
  readonly members?: readonly Membership[];
  readonly nextCursor?: string | null;
  /** What each method throws, if anything. Keyed by method, so one fake covers a screen. */
  readonly rejectWith?: Partial<Record<MembershipCall['method'], unknown>>;
}

/**
 * A `MembershipServiceI` that records what it was asked and answers without a transport.
 *
 * The `statuses` it recorded is the interesting part: rule G2 says an ordinary member
 * must not ask for the pending ones, because the server answers `forbidden` rather than
 * an empty page. That is a property of the **request**, so it can only be asserted on
 * the double.
 */
export function fakeMembershipService(options: FakeMembershipOptions = {}) {
  const members = signal<readonly Membership[]>(options.members ?? []);
  const calls: MembershipCall[] = [];

  function refuseIfAsked(method: MembershipCall['method']): void {
    const rejection = options.rejectWith?.[method];
    if (rejection !== undefined) {
      throw rejection;
    }
  }

  function patch(
    membershipId: string,
    changes: Partial<Membership>
  ): Membership {
    const existing = members().find((member) => member.id === membershipId);
    const updated: Membership = {
      id: membershipId,
      zoneId: existing?.zoneId ?? 'zone-1',
      userId: existing?.userId ?? 'u-other',
      username: existing?.username ?? '',
      role: existing?.role ?? 'MEMBER',
      status: existing?.status ?? 'APPROVED',
      ...changes,
    };

    members.update((current) =>
      current.map((member) => (member.id === membershipId ? updated : member))
    );
    return updated;
  }

  const service: MembershipServiceI = {
    listMembers: async (zoneId, listOptions) => {
      calls.push({
        method: 'listMembers',
        zoneId,
        statuses: listOptions?.statuses,
      });
      refuseIfAsked('listMembers');

      const statuses = listOptions?.statuses ?? ['APPROVED'];
      return {
        items: members().filter((member) => statuses.includes(member.status)),
        nextCursor: options.nextCursor ?? null,
      };
    },

    approve: async (zoneId, membershipId) => {
      calls.push({ method: 'approve', zoneId, membershipId });
      refuseIfAsked('approve');
      return patch(membershipId, { status: 'APPROVED' });
    },

    reject: async (zoneId, membershipId) => {
      calls.push({ method: 'reject', zoneId, membershipId });
      refuseIfAsked('reject');
      members.update((current) =>
        current.filter((member) => member.id !== membershipId)
      );
      return membershipId;
    },

    kick: async (zoneId, membershipId) => {
      calls.push({ method: 'kick', zoneId, membershipId });
      refuseIfAsked('kick');
      return patch(membershipId, { status: 'KICKED' });
    },

    ban: async (zoneId, membershipId) => {
      calls.push({ method: 'ban', zoneId, membershipId });
      refuseIfAsked('ban');
      return patch(membershipId, { status: 'BANNED' });
    },

    setRole: async (zoneId, membershipId, role) => {
      calls.push({ method: 'setRole', zoneId, membershipId, role });
      refuseIfAsked('setRole');
      return patch(membershipId, { role });
    },

    transferOwnership: async (zoneId, membershipId) => {
      calls.push({ method: 'transferOwnership', zoneId, membershipId });
      refuseIfAsked('transferOwnership');
      return {
        id: zoneId,
        name: 'Flat 3B',
        joinCode: 'HK7M2QPD',
        status: 'ACTIVE',
        ownerUserId: 'u-other',
      };
    },

    setUsername: async (zoneId, membershipId, username) => {
      calls.push({ method: 'setUsername', zoneId, membershipId, username });
      refuseIfAsked('setUsername');
      return patch(membershipId, { username });
    },
  };

  return {
    ...service,
    /** Everything the screen asked for, in order. */
    calls: calls as readonly MembershipCall[],
    /** What the fake currently holds. */
    members: () => members(),
  };
}

export type FakeMembershipService = ReturnType<typeof fakeMembershipService>;

/** {@link fakeMembershipService} bound to the real token. */
export function provideFakeMembershipService(
  service: FakeMembershipService
): Provider {
  return { provide: MEMBERSHIP_SERVICE, useValue: service };
}

/**
 * The real `AccountNotice`, provided.
 *
 * Deliberately not a double: it is one signal and two setters with no dependencies, so
 * faking it would mean writing the same object twice and would let a spec pass against
 * behaviour the app does not have.
 */
export function provideAccountNotice(): Provider {
  return AccountNotice;
}
