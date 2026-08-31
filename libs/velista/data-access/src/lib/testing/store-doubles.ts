import { computed, signal, type Provider } from '@angular/core';
import type {
  Comment,
  Identity,
  Line,
  LineApprovalStatus,
  LineStatus,
  Membership,
  MembershipStatus,
  MyZone,
  PresenceEditor,
  PresenceUser,
  ProfileLoad,
  SessionTokens,
  ShoppingListSummary,
  ShoppingProfile,
  Supermarket,
  UserKind,
  UsernameScope,
  UserProfile,
  WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { ProfileStore } from '../account/profile-store';
import { AccountNotice } from '../auth/account-notice';
import {
  AUTH_SERVICE,
  type AuthServiceI,
  type ResendOutcome,
  type VerifiedEmail,
} from '../auth/auth-service';
import { SessionStore } from '../auth/session-store';
import { LineStore, type LineLoadState } from '../lines/line-store';
import { ListStore, type ListLoadState } from '../lists/list-store';
import { MemberNames } from '../memberships/member-names';
import {
  MEMBERSHIP_SERVICE,
  type MembershipServiceI,
} from '../memberships/membership-service';
import { PresenceStore } from '../presence/presence-store';
import {
  ShoppingProfileStore,
  type FieldSaveState,
  type ProfileField,
} from '../profiles/shopping-profile-store';
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

  /** The zone whose join code was just replaced, which the group page says once. */
  readonly lastCodeChange?: string | null;

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
  const lastCodeChange = signal<string | null>(options.lastCodeChange ?? null);

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

    // ---------------------------------------------------------- plan 0015

    /**
     * Drive a live rename at a members screen that is already mounted.
     *
     * This is the whole of section 5.8's acceptance criterion: a rename that propagates
     * to the groups has to change an open members list **without a refetch**, and a
     * spec proves it by calling this and asserting the row changed while `loadCount`
     * stood still.
     */

    lastCodeChange: lastCodeChange.asReadonly(),
    clearLastCodeChange: () => lastCodeChange.set(null),

    /** Put a page into the state it would be in straight after a new code. */
    setLastCodeChange: (zoneId: string | null) => lastCodeChange.set(zoneId),

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
    // Records the change on success, as the real store does, so a spec that drives
    // the sheet sees what the page behind it would actually be handed.
    regenerateJoinCode: async (zoneId: string) => {
      const outcome = record({ method: 'regenerateJoinCode', zoneId });
      if (outcome.state === 'succeeded') {
        lastCodeChange.set(zoneId);
      }
      return outcome;
    },
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
  | { readonly method: 'resendVerification' }
  | { readonly method: 'forgotPassword'; readonly email: string };

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

  /** What a password reset ask answers. The default is a send with a wait. */
  readonly forgotPassword?: ResendOutcome;
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

    forgotPassword: async (email: string): Promise<ResendOutcome> => {
      calls.push({ method: 'forgotPassword', email });
      // Defaulted separately from the resend, because the two buckets differ and a
      // shared default would hide the difference rule A4 is about: the reset is one
      // per minute and the rename is five per hour.
      return options.forgotPassword ?? { state: 'sent', waitSeconds: 60 };
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

  const created: { zoneId: string; name: string; shareWithZone: boolean }[] =
    [];

  return {
    /** How many times a page asked for this zone's lists. Starts at zero. */
    loadCount: loads.asReadonly(),

    /** Every list this page asked to create. */
    creations: created as readonly {
      readonly zoneId: string;
      readonly name: string;
      readonly shareWithZone: boolean;
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

    createList: async (
      zoneId: string,
      name: string,
      shareWithZone: boolean
    ) => {
      // The flag is recorded rather than dropped: the sheet's whole job is to send
      // the answer somebody ticked, and a double that swallowed it would pass whether
      // or not the checkbox was wired to anything.
      created.push({ zoneId, name, shareWithZone });
      const list: ShoppingListSummary = {
        id: 'list-new',
        zoneId,
        name,
        createdByUserId: 'u1',
        lineCount: 0,
        readyCount: 0,
        autoApproveLines: false,
        sharedWithZone: shareWithZone,
        // All four, because the person who just created a list holds all four on it
        // (backend plan 0036, section 2.5). A double that answered an empty set would
        // have the page draw a read only banner over a list its reader had just made.
        myPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
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

export interface FakeLineStateOptions {
  readonly lines?: readonly Line[];
  readonly state?: LineLoadState;
  readonly error?: unknown;
  /** Whether every page has arrived. False turns dragging off (rule L4). */
  readonly complete?: boolean;
  /** What the next write answers, so a spec can drive the failure paths. */
  readonly writeOutcome?: 'succeeded' | 'failed' | 'overwritten';
}

/** One write a page asked for, so a spec can assert what was sent and in what order. */
export type LineWriteCall =
  | {
      readonly kind: 'add';
      readonly content: string;
      readonly quantity: number;
    }
  | {
      readonly kind: 'status';
      readonly lineId: string;
      readonly status: LineStatus;
    }
  | {
      readonly kind: 'approval';
      readonly lineId: string;
      readonly status: LineApprovalStatus;
    }
  | { readonly kind: 'update'; readonly lineId: string }
  | { readonly kind: 'delete'; readonly lineId: string }
  | { readonly kind: 'reorder'; readonly orderedLineIds: readonly string[] };

/**
 * A `LineStore` that is simply in the state you asked for.
 *
 * `fakeListStore`'s reasoning one level down, and the calls it records are what several
 * of plan 0012's acceptance criteria actually turn on. Rule L3 in particular is a claim
 * about **two requests in order**: a staff member's add is followed by an approval of
 * the id that came back, and a plain member's is not. Only a double that keeps the
 * sequence can state that.
 *
 * `addedApprovalStatus` exists for the other half of L3: when the backend's auto
 * approve option lands, the created line comes back already APPROVED and the second
 * call must stop happening on its own, with no edit to the page.
 */
export function fakeLineStore(options: FakeLineStateOptions = {}) {
  const lines = signal<readonly Line[]>(options.lines ?? []);
  const state = signal<LineLoadState>(options.state ?? 'loaded');
  const error = signal<unknown>(options.error ?? null);
  const complete = signal(options.complete ?? true);
  const writes = signal<
    ReadonlyMap<
      string,
      {
        readonly outcome: 'pending' | 'failed' | 'overwritten';
        readonly byUserId: string | null;
      }
    >
  >(new Map());
  const commentCounts = signal<ReadonlyMap<string, number>>(new Map());
  /** Newest first, the wire's order, which is the order the real store keeps. */
  const comments = signal<ReadonlyMap<string, readonly Comment[]>>(new Map());
  const loads = signal(0);

  const calls: LineWriteCall[] = [];
  let outcome = options.writeOutcome ?? 'succeeded';
  /** What an add answers with. APPROVED here makes rule L3's second call unnecessary. */
  let addedApproval: LineApprovalStatus = 'PENDING';

  return {
    loadCount: loads.asReadonly(),
    calls: calls as readonly LineWriteCall[],

    linesIn: () => lines(),
    stateOf: () => state(),
    errorOf: () => error(),
    isComplete: () => complete(),
    writeNoteOf: (lineId: string) => writes().get(lineId) ?? null,
    commentCountOf: (lineId: string) => commentCounts().get(lineId),
    commentsOf: (lineId: string) => comments().get(lineId),
    forList: () =>
      computed(() => ({
        lines: lines(),
        state: state(),
        error: error(),
        complete: complete(),
        writes: writes(),
        commentCounts: commentCounts(),
      })),

    load: async () => {
      loads.update((count) => count + 1);
    },
    refresh: async () => {
      loads.update((count) => count + 1);
    },

    addLine: async (
      listId: string,
      content: string,
      quantity: number,
      createdByUserId: string
    ) => {
      calls.push({ kind: 'add', content, quantity });

      if (outcome === 'failed') {
        return { state: 'failed' as const, error: new Error('add failed') };
      }

      const added: Line = {
        id: 'server-id',
        listId,
        content,
        quantity,
        itemId: null,
        position: lines().length + 1,
        approvalStatus: addedApproval,
        status: 'PENDING',
        createdByUserId,
        approvedByUserId: null,
        version: 1,
      };
      lines.update((current) => [...current, added]);
      return { state: 'added' as const, line: added };
    },

    updateLine: async (lineId: string) => {
      calls.push({ kind: 'update', lineId });
      return outcome;
    },

    setStatus: async (lineId: string, status: LineStatus) => {
      calls.push({ kind: 'status', lineId, status });
      if (outcome === 'succeeded') {
        lines.update((current) =>
          current.map((l) => (l.id === lineId ? { ...l, status } : l))
        );
      }
      return outcome;
    },

    setApproval: async (lineId: string, status: LineApprovalStatus) => {
      calls.push({ kind: 'approval', lineId, status });
      return outcome;
    },

    reorder: async (_listId: string, orderedLineIds: readonly string[]) => {
      calls.push({ kind: 'reorder', orderedLineIds });
      return outcome === 'failed'
        ? ('failed' as const)
        : ('succeeded' as const);
    },

    deleteLine: async (lineId: string) => {
      calls.push({ kind: 'delete', lineId });
      return outcome === 'failed'
        ? { state: 'failed' as const, error: new Error('delete failed') }
        : { state: 'deleted' as const };
    },

    recordCommentCount: (lineId: string, count: number) => {
      commentCounts.update((current) => new Map(current).set(lineId, count));
    },
    recordComments: (lineId: string, page: readonly Comment[]) => {
      comments.update((current) => new Map(current).set(lineId, page));
      commentCounts.update((current) =>
        new Map(current).set(lineId, page.length)
      );
    },
    /** Prepends, because the real store holds the wire's newest first order. */
    addComment: (comment: Comment) => {
      comments.update((current) => {
        const held = current.get(comment.lineId) ?? [];
        return new Map(current).set(comment.lineId, [comment, ...held]);
      });
    },
    dismissNote: (lineId: string) => {
      writes.update((current) => {
        const next = new Map(current);
        next.delete(lineId);
        return next;
      });
    },
    forget: () => undefined,

    /** Move the store while a fixture is mounted, to test a live update. */
    set: (next: readonly Line[]) => lines.set(next),
    setState: (next: LineLoadState, cause: unknown = null) => {
      state.set(next);
      error.set(cause);
    },
    setComplete: (next: boolean) => complete.set(next),
    setWriteOutcome: (next: 'succeeded' | 'failed' | 'overwritten') => {
      outcome = next;
    },
    /** What a created line comes back as. APPROVED is the backend's auto approve. */
    setAddedApproval: (next: LineApprovalStatus) => {
      addedApproval = next;
    },
    setNote: (
      lineId: string,
      note: {
        readonly outcome: 'pending' | 'failed' | 'overwritten';
        readonly byUserId: string | null;
      }
    ) => writes.update((current) => new Map(current).set(lineId, note)),
  };
}

export type FakeLineStore = ReturnType<typeof fakeLineStore>;

/** {@link fakeLineStore} bound to the real token. */
export function provideFakeLineStore(store: FakeLineStore): Provider {
  return { provide: LineStore, useValue: store };
}

/**
 * A `MemberNames` that resolves whatever map it was given.
 *
 * The absence of a name is the interesting case rather than the presence of one: a
 * comment outlives its author's membership, so an unresolved id has to render as a
 * neutral phrase and never as an id (plan 0012, section 5.4).
 */
export function fakeMemberNames(
  names: Readonly<Record<string, string>> = {},
  members: readonly Membership[] = []
) {
  /**
   * Every zone whose members were asked for, in order and without repeats.
   *
   * `ensure` is a request in production, so **whether** a screen makes it is a design
   * decision rather than plumbing: plan 0022 asks for a group's names only once
   * somebody is actually present in it, so that an advisory row costs nothing on a
   * dashboard where nobody is. That is a property of the call and can only be asserted
   * on the double.
   */
  const asked: string[] = [];

  return {
    nameOf: (_zoneId: string, userId: string) => names[userId] ?? null,
    /**
     * The role from whichever seeded membership carries this user id, or null.
     *
     * Read off `members` rather than taking a map of its own, so a fixture cannot seed
     * a role for somebody the share sheet has never heard of. Null is the ordinary
     * answer for a fake given only names, which is the state every screen is in before
     * the members request lands.
     */
    roleOf: (_zoneId: string, userId: string) =>
      members.find((member) => member.userId === userId)?.role ?? null,
    membersOf: () => members,
    ensure: async (zoneId: string) => {
      if (!asked.includes(zoneId)) {
        asked.push(zoneId);
      }
    },
    prime: () => undefined,
    asked,
  };
}

export function provideFakeMemberNames(
  store: ReturnType<typeof fakeMemberNames>
): Provider {
  return { provide: MemberNames, useValue: store };
}

/** Who a fake says is present, per zone and per list (plan 0017). */
export interface FakePresenceOptions {
  /** Zone id to the user ids online in it. */
  readonly online?: Readonly<Record<string, readonly string[]>>;
  /** List id to the user ids looking at it. */
  readonly viewers?: Readonly<Record<string, readonly string[]>>;
  /** List id to `userId -> lineId`, for who is editing what. */
  readonly editors?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * List id to `userId -> when this client first saw them`, in epoch milliseconds.
   *
   * Absent is the interesting case rather than present: a viewer with no arrival time
   * is what every page draws on its first frame and after every reconnection, so it is
   * the state the header's panel has to read well.
   */
  readonly since?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/**
 * A `PresenceStore` holding whatever it was given, with no socket behind it.
 *
 * Takes user ids rather than `PresenceUser`s because that is what the wire carries:
 * presence payloads have no username in them, so a double that accepted names would
 * let a screen pass a test by rendering a field the server never sends
 * (plan 0017, section 3.4).
 */
export function fakePresenceStore(options: FakePresenceOptions = {}) {
  const users = (ids: readonly string[] = []): readonly PresenceUser[] =>
    ids.map((userId) => ({ userId, username: '' }));

  const editorsOf = (listId: string): readonly PresenceEditor[] =>
    Object.entries(options.editors?.[listId] ?? {}).map(([userId, lineId]) => ({
      userId,
      username: '',
      lineId,
    }));

  return {
    onlineIn: (zoneId: string) => users(options.online?.[zoneId]),
    viewersOf: (listId: string) => users(options.viewers?.[listId]),
    viewerSince: (listId: string, userId: string) => {
      const at = options.since?.[listId]?.[userId];
      return at === undefined ? null : new Date(at);
    },
    editorsOf,
    editorOfLine: (listId: string, lineId: string) =>
      editorsOf(listId).find((editor) => editor.lineId === lineId) ?? null,
    forList: (listId: string) =>
      computed(() => ({
        listId,
        viewers: users(options.viewers?.[listId]),
        editors: editorsOf(listId),
      })),
    clear: () => undefined,
  };
}

export type FakePresenceStore = ReturnType<typeof fakePresenceStore>;

/** {@link fakePresenceStore} bound to the real token. */
export function provideFakePresenceStore(
  store: FakePresenceStore = fakePresenceStore()
): Provider {
  return { provide: PresenceStore, useValue: store };
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

/** How a faked `ProfileStore` should present the caller (plan 0015). */
export interface FakeProfileOptions {
  readonly profile?: UserProfile | null;
  readonly state?: ProfileLoad;
  readonly error?: unknown;
  /** What `rename` throws back as its failure, if anything. */
  readonly renameRejectsWith?: unknown;
  /** What `remove` throws back as its failure, if anything. */
  readonly removeRejectsWith?: unknown;
}

/** One recorded call to a faked `ProfileStore`. */
export type ProfileCall =
  | { readonly method: 'load' }
  | {
      readonly method: 'rename';
      readonly username: string;
      readonly scope: UsernameScope;
    }
  | { readonly method: 'remove' }
  | { readonly method: 'clear' };

/**
 * A `ProfileStore` that answers without a transport.
 *
 * {@link fakeZoneStore}'s reasoning, and one thing specific to this store: the real one
 * writes the **response** into itself rather than the string it was handed, so a fake
 * that echoed the argument would let a page pass a test the server would fail. This one
 * updates its held profile from the argument only because it has no server to normalize
 * it, and `ProfileStore` keeps its own spec for the part that matters.
 */
export function fakeProfileStore(options: FakeProfileOptions = {}) {
  const calls: ProfileCall[] = [];
  const profile = signal<UserProfile | null>(options.profile ?? null);
  const state = signal<ProfileLoad>(options.state ?? 'loaded');

  return {
    profile: profile.asReadonly(),
    state: state.asReadonly(),
    error: () => options.error ?? null,
    username: computed(() => {
      const held = profile();
      return held === null || held.username === '' ? null : held.username;
    }),

    load: async () => {
      calls.push({ method: 'load' });
    },

    rename: async (username: string, scope: UsernameScope) => {
      calls.push({ method: 'rename', username, scope });
      if (options.renameRejectsWith !== undefined) {
        return { state: 'failed' as const, error: options.renameRejectsWith };
      }

      profile.update((held) => (held === null ? held : { ...held, username }));
      return { state: 'renamed' as const };
    },

    remove: async () => {
      calls.push({ method: 'remove' });
      return options.removeRejectsWith !== undefined
        ? { state: 'failed' as const, error: options.removeRejectsWith }
        : { state: 'deleted' as const };
    },

    clear: () => {
      calls.push({ method: 'clear' });
      profile.set(null);
    },

    /** Everything the page asked for, in order. */
    calls: calls as readonly ProfileCall[],
  };
}

export type FakeProfileStore = ReturnType<typeof fakeProfileStore>;

/** {@link fakeProfileStore} bound to the real class. */
export function provideFakeProfileStore(
  store: FakeProfileStore = fakeProfileStore()
): Provider {
  return { provide: ProfileStore, useValue: store };
}

/**
 * A `UserProfile` with the shape the app actually reads.
 *
 * A registered, confirmed account by default, because that is the screen most specs
 * are about; the guest and the unconfirmed states are one override each.
 */
export function profileFor(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'u1',
    kind: 'REGISTERED',
    username: 'Dani',
    email: 'dani@example.com',
    emailVerified: true,
    displayName: null,
    ...overrides,
  };
}

// --- Shopping profiles (plan 0046) -------------------------------------------

/**
 * A `ShoppingProfile` with the shape the page actually reads.
 *
 * The default is the lazily created one a brand new account gets: a null name, nothing
 * else set, and the default flag on it. Every other state is one override.
 */
export function shoppingProfileFor(
  overrides: Partial<ShoppingProfile> = {}
): ShoppingProfile {
  return {
    id: 'sp1',
    name: null,
    isDefault: true,
    position: 0,
    addressText: null,
    minSavingCents: 0,
    postalCodes: [],
    chains: [],
    ...overrides,
  };
}

export interface FakeShoppingProfileOptions {
  readonly profiles?: readonly ShoppingProfile[];
  readonly state?: ProfileLoad;
  readonly error?: unknown;
  readonly chains?: readonly Supermarket[];
  /** Codes the catalog is pretending nobody serves. */
  readonly unserved?: readonly string[];
  /** Which controls answer `failed` rather than saving. */
  readonly failing?: readonly ProfileField[];
  /** Whether `create` fails rather than minting a profile. */
  readonly createFails?: boolean;
  /** Whether `remove` fails rather than deleting. */
  readonly removeFails?: boolean;
}

/** One recorded call to a faked `ShoppingProfileStore`. */
export type ShoppingProfileCall =
  | { readonly method: 'load' }
  | { readonly method: 'select'; readonly profileId: string }
  | { readonly method: 'create' }
  | {
      readonly method: 'save';
      readonly profileId: string;
      readonly field: ProfileField;
      readonly body: WriteShoppingProfileRequest;
    }
  | { readonly method: 'makeDefault'; readonly profileId: string }
  | { readonly method: 'remove'; readonly profileId: string }
  | { readonly method: 'clear' };

/**
 * A `ShoppingProfileStore` that answers without a transport.
 *
 * {@link fakeZoneStore}'s reasoning, and two things specific to this one.
 *
 * It **applies** what a page saves, through the same `apply` the real store hands to
 * its overlay, so a spec asserting that the screen followed the selector or that a
 * chain came back un-excluded is asserting the rendered result rather than the fact
 * that a method was called. A save it is told to fail changes nothing and reports
 * `failed`, which is the state the failed treatment is drawn from.
 *
 * It keeps the real store's rule that **the list is never empty**: the server creates
 * the default profile on the first read, so a fake with no profiles would put a page
 * into a state that cannot happen.
 */
export function fakeShoppingProfileStore(
  options: FakeShoppingProfileOptions = {}
) {
  const calls: ShoppingProfileCall[] = [];
  const profiles = signal<readonly ShoppingProfile[]>(
    options.profiles ?? [shoppingProfileFor()]
  );
  const state = signal<ProfileLoad>(options.state ?? 'loaded');
  const selectedId = signal<string | null>(null);
  const saves = signal<ReadonlyMap<string, FieldSaveState>>(new Map());
  const failing = new Set<ProfileField>(options.failing ?? []);
  const unserved = new Set(options.unserved ?? []);
  let minted = 0;

  const selected = computed<ShoppingProfile | null>(() => {
    const held = profiles();
    const id = selectedId();
    return (
      held.find((profile) => profile.id === id) ??
      held.find((profile) => profile.isDefault) ??
      held[0] ??
      null
    );
  });

  const setSave = (key: string, next: FieldSaveState): void => {
    saves.update((current) => {
      const map = new Map(current);
      if (next === 'idle') {
        map.delete(key);
      } else {
        map.set(key, next);
      }
      return map;
    });
  };

  const successorOf = (profileId: string): ShoppingProfile | null => {
    const held = profiles();
    const going = held.find((profile) => profile.id === profileId);
    return going === undefined || !going.isDefault
      ? null
      : (held.find((profile) => profile.id !== profileId) ?? null);
  };

  return {
    profiles: profiles.asReadonly(),
    state: state.asReadonly(),
    error: () => options.error ?? null,
    chains: signal<readonly Supermarket[]>(options.chains ?? []).asReadonly(),
    selected,

    scopeSaid: computed(() => {
      const profile = selected();
      return (
        profile !== null &&
        (profile.postalCodes.length > 0 ||
          profile.chains.some((chain) => !chain.excluded))
      );
    }),

    saveState: (profileId: string, field: ProfileField): FieldSaveState =>
      saves().get(`${profileId}:${field}`) ?? 'idle',

    isUnserved: (postalCode: string): boolean => unserved.has(postalCode),

    successorOf,

    load: async () => {
      calls.push({ method: 'load' });
    },

    select: (profileId: string) => {
      calls.push({ method: 'select', profileId });
      selectedId.set(profileId);
    },

    refreshCoverage: async () => {
      // Nothing to refresh: this fake's coverage is whatever the spec declared.
    },

    create: async (): Promise<ShoppingProfile | null> => {
      calls.push({ method: 'create' });
      if (options.createFails === true) {
        return null;
      }

      const created = shoppingProfileFor({
        id: `sp-new-${++minted}`,
        isDefault: false,
        position: profiles().length,
      });
      profiles.update((held) => [...held, created]);
      selectedId.set(created.id);
      return created;
    },

    save: async (
      profileId: string,
      field: ProfileField,
      body: WriteShoppingProfileRequest,
      apply: (profile: ShoppingProfile) => ShoppingProfile
    ): Promise<'saved' | 'failed'> => {
      calls.push({ method: 'save', profileId, field, body });

      if (failing.has(field)) {
        setSave(`${profileId}:${field}`, 'failed');
        return 'failed';
      }

      profiles.update((held) =>
        held.map((profile) =>
          profile.id === profileId ? apply(profile) : profile
        )
      );
      setSave(`${profileId}:${field}`, 'idle');
      return 'saved';
    },

    makeDefault: async (profileId: string): Promise<'saved' | 'failed'> => {
      calls.push({ method: 'makeDefault', profileId });
      profiles.update((held) =>
        held.map((profile) => ({
          ...profile,
          isDefault: profile.id === profileId,
        }))
      );
      return 'saved';
    },

    remove: async (profileId: string): Promise<'deleted' | 'failed'> => {
      calls.push({ method: 'remove', profileId });
      if (options.removeFails === true) {
        return 'failed';
      }

      const successor = successorOf(profileId);
      profiles.update((held) =>
        held
          .filter((profile) => profile.id !== profileId)
          .map((profile) => ({
            ...profile,
            isDefault:
              successor === null
                ? profile.isDefault
                : profile.id === successor.id,
          }))
      );
      if (selectedId() === profileId) {
        selectedId.set(null);
      }
      return 'deleted';
    },

    clear: () => {
      calls.push({ method: 'clear' });
      profiles.set([]);
    },

    /** Everything the page asked for, in order. */
    calls: calls as readonly ShoppingProfileCall[],
  };
}

export type FakeShoppingProfileStore = ReturnType<
  typeof fakeShoppingProfileStore
>;

/** {@link fakeShoppingProfileStore} bound to the real class. */
export function provideFakeShoppingProfileStore(
  store: FakeShoppingProfileStore = fakeShoppingProfileStore()
): Provider {
  return { provide: ShoppingProfileStore, useValue: store };
}
