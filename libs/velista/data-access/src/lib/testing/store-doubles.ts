import { computed, signal, type Provider } from '@angular/core';
import type { Identity, MyZone, UserKind } from '@portfolio/velista/models';
import { SessionStore } from '../auth/session-store';
import {
  ZoneStore,
  type ZoneEntry,
  type ZoneEntryOutcome,
  type ZoneLoadState,
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
}

/** One recorded call to a faked mutation. */
export type ZoneMutationCall =
  | { readonly method: 'createZone'; readonly name: string }
  | { readonly method: 'joinZone'; readonly joinCode: string };

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
