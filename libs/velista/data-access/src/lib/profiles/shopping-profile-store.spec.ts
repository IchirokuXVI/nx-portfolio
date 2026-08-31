import { TestBed } from '@angular/core/testing';
import type {
  CatalogScope,
  ShoppingProfile,
  Supermarket,
  WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { GatewayError } from '../errors';
import { Mutations } from '../mutations';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  SHOPPING_PROFILE_SERVICE,
  type ShoppingProfileServiceI,
} from './shopping-profile-service';
import { ShoppingProfileStore } from './shopping-profile-store';

function profile(overrides: Partial<ShoppingProfile> = {}): ShoppingProfile {
  return {
    id: 'p1',
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

const CHAINS: readonly Supermarket[] = [
  { id: 'c1', name: { en: 'Mercadona', es: 'Mercadona' } },
  { id: 'c2', name: { en: 'DIA', es: 'DIA' } },
];

interface FakeOptions {
  readonly profiles?: readonly ShoppingProfile[];
  readonly listRejectsWith?: unknown;
  readonly updateRejectsWith?: unknown;
  readonly unserved?: readonly string[];
  /** What the server answers to an update, which is not what was sent. */
  readonly normalizeTo?: Partial<ShoppingProfile>;
}

/** A `ShoppingProfileServiceI` that records what it was asked, with no transport. */
function fakeService(options: FakeOptions = {}) {
  const calls: {
    method: string;
    profileId?: string;
    body?: WriteShoppingProfileRequest;
  }[] = [];
  let held = [...(options.profiles ?? [profile()])];

  const service: ShoppingProfileServiceI = {
    listProfiles: async () => {
      calls.push({ method: 'listProfiles' });
      if (options.listRejectsWith !== undefined) {
        throw options.listRejectsWith;
      }
      return held;
    },

    createProfile: async (body) => {
      calls.push({ method: 'createProfile', body });
      const created = profile({
        id: `p${held.length + 1}`,
        isDefault: false,
        position: held.length,
      });
      held = [...held, created];
      return created;
    },

    updateProfile: async (profileId, body) => {
      calls.push({ method: 'updateProfile', profileId, body });
      if (options.updateRejectsWith !== undefined) {
        throw options.updateRejectsWith;
      }

      const before = held.find((entry) => entry.id === profileId);
      const after = {
        ...(before ?? profile({ id: profileId })),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.addressText === undefined
          ? {}
          : { addressText: body.addressText }),
        ...(body.minSavingCents === undefined
          ? {}
          : { minSavingCents: body.minSavingCents }),
        // The collections are full replacements on the wire, so the fake replaces
        // them too: a fake that ignored them would let the store's coverage refresh
        // pass against a profile the server never actually changed.
        ...(body.postalCodes === undefined
          ? {}
          : {
              postalCodes: body.postalCodes.map((entry, position) => ({
                id: `pc-${position}`,
                postalCode: entry.postalCode,
                label: entry.label ?? null,
                position,
              })),
            }),
        ...(body.supermarkets === undefined
          ? {}
          : {
              chains: body.supermarkets.map((entry) => ({
                id: `sm-${entry.supermarketId}`,
                supermarketId: entry.supermarketId,
                excluded: entry.excluded === true,
              })),
            }),
        ...(options.normalizeTo ?? {}),
      };
      held = held.map((entry) => (entry.id === profileId ? after : entry));
      return after;
    },

    makeDefault: async (profileId) => {
      calls.push({ method: 'makeDefault', profileId });
      held = held.map((entry) => ({
        ...entry,
        isDefault: entry.id === profileId,
      }));
      return held.find((entry) => entry.id === profileId) ?? profile();
    },

    deleteProfile: async (profileId) => {
      calls.push({ method: 'deleteProfile', profileId });
      held = held.filter((entry) => entry.id !== profileId);
    },

    listSupermarkets: async () => {
      calls.push({ method: 'listSupermarkets' });
      return CHAINS;
    },

    describeScope: async (profileId): Promise<CatalogScope> => {
      calls.push({ method: 'describeScope', profileId });
      const current = held.find((entry) => entry.id === profileId);
      return {
        profileId,
        coverage: (current?.postalCodes ?? []).map((code) => ({
          postalCode: code.postalCode,
          served: !(options.unserved ?? []).includes(code.postalCode),
        })),
        approximate: false,
      };
    },
  };

  return { ...service, calls };
}

function setUp(service: ReturnType<typeof fakeService>): {
  store: ShoppingProfileStore;
  realtime: RealtimeMemory;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      Mutations,
      ShoppingProfileStore,
      { provide: SHOPPING_PROFILE_SERVICE, useValue: service },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return {
    store: TestBed.inject(ShoppingProfileStore),
    realtime: TestBed.inject(RealtimeMemory),
  };
}

describe('ShoppingProfileStore', () => {
  describe('loading', () => {
    it('holds the list, the chains and the coverage from one call', async () => {
      const { store } = setUp(fakeService());

      await store.load();

      expect(store.state()).toBe('loaded');
      expect(store.profiles()).toHaveLength(1);
      expect(store.chains()).toHaveLength(2);
    });

    it('records a failure without throwing, so the retry line can render', async () => {
      const { store } = setUp(
        fakeService({
          listRejectsWith: new GatewayError({
            code: 'internal',
            status: 500,
            correlationId: 'c1',
          }),
        })
      );

      await store.load();

      expect(store.state()).toBe('failed');
      expect(store.profiles()).toEqual([]);
    });

    it('asks for the chains once, however many times the page loads', async () => {
      // Cached for the page's life (section 5). The catalog's chains do not change
      // while somebody is filling in an address.
      const service = fakeService();
      const { store } = setUp(service);

      await store.load();
      await store.load();

      expect(
        service.calls.filter((call) => call.method === 'listSupermarkets')
      ).toHaveLength(1);
    });

    it('does not blank the list on a second load', async () => {
      // Re-reading is how the retry works, and a screen that emptied itself first
      // would flash between the list it has and the list it is about to have again.
      const { store } = setUp(fakeService());
      await store.load();

      const second = store.load();
      expect(store.profiles()).toHaveLength(1);
      await second;
    });
  });

  describe('the selection', () => {
    it('falls back to the default when nothing has been chosen', async () => {
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({ id: 'a', isDefault: false, position: 0 }),
            profile({ id: 'b', isDefault: true, position: 1 }),
          ],
        })
      );

      await store.load();

      expect(store.selected()?.id).toBe('b');
    });

    it('follows the chosen profile', async () => {
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({ id: 'a', isDefault: false }),
            profile({ id: 'b', isDefault: true }),
          ],
        })
      );
      await store.load();

      store.select('a');

      expect(store.selected()?.id).toBe('a');
    });
  });

  describe('scopeSaid', () => {
    it('is false for a profile with nothing on it', async () => {
      const { store } = setUp(fakeService());
      await store.load();

      expect(store.scopeSaid()).toBe(false);
    });

    it('is false for a profile holding only exclusions', async () => {
      // "not DIA" is not a place, which is the server's own rule.
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({
              chains: [{ id: 'x', supermarketId: 'c2', excluded: true }],
            }),
          ],
        })
      );
      await store.load();

      expect(store.scopeSaid()).toBe(false);
    });

    it('is true once there is a postal code', async () => {
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({
              postalCodes: [
                { id: 'pc1', postalCode: '14013', label: null, position: 0 },
              ],
            }),
          ],
        })
      );
      await store.load();

      expect(store.scopeSaid()).toBe(true);
    });
  });

  describe('saving', () => {
    it('adopts the server answer rather than what was sent', async () => {
      // The two differ whenever the server normalizes, and writing back the argument
      // would leave the screen showing a name the server does not have.
      const service = fakeService({ normalizeTo: { name: 'Trimmed' } });
      const { store } = setUp(service);
      await store.load();

      await store.save('p1', 'name', { name: '  Trimmed  ' }, (current) => ({
        ...current,
        name: '  Trimmed  ',
      }));

      expect(store.selected()?.name).toBe('Trimmed');
      expect(store.saveState('p1', 'name')).toBe('idle');
    });

    it('snaps the control back and reports failed', async () => {
      const service = fakeService({
        updateRejectsWith: new GatewayError({
          code: 'internal',
          status: 500,
          correlationId: 'c1',
        }),
      });
      const { store } = setUp(service);
      await store.load();

      const outcome = await store.save(
        'p1',
        'name',
        { name: 'Home' },
        (current) => ({ ...current, name: 'Home' })
      );

      expect(outcome).toBe('failed');
      // The overlay is dropped by `Mutations.run` before the outcome is reported, so
      // by here the field is back to what the server still holds.
      expect(store.selected()?.name).toBeNull();
      expect(store.saveState('p1', 'name')).toBe('failed');
    });

    it('re-asks for coverage after a postal code write', async () => {
      // A code that was just typed has no coverage answer yet, and the flag has to
      // land under its own chip.
      const service = fakeService();
      const { store } = setUp(service);
      await store.load();
      const before = service.calls.filter(
        (call) => call.method === 'describeScope'
      ).length;

      await store.save(
        'p1',
        'postalCodes',
        { postalCodes: [{ postalCode: '14013', label: null }] },
        (current) => ({
          ...current,
          postalCodes: [
            { id: 'pending', postalCode: '14013', label: null, position: 0 },
          ],
        })
      );

      expect(
        service.calls.filter((call) => call.method === 'describeScope').length
      ).toBeGreaterThan(before);
    });

    it('flags a postal code nobody serves rather than refusing it', async () => {
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({
              postalCodes: [
                { id: 'pc1', postalCode: '05631', label: null, position: 0 },
              ],
            }),
          ],
          unserved: ['05631'],
        })
      );

      await store.load();

      expect(store.isUnserved('05631')).toBe(true);
      expect(store.selected()?.postalCodes).toHaveLength(1);
    });
  });

  describe('creating', () => {
    it('mints a profile with no name and selects it', async () => {
      // Null, and not the English words: the page renders the localized default,
      // because the server does not know the caller's language.
      const service = fakeService();
      const { store } = setUp(service);
      await store.load();

      const created = await store.create();

      expect(created?.name).toBeNull();
      expect(store.selected()?.id).toBe(created?.id);
      expect(store.profiles()).toHaveLength(2);
    });

    it('does not add it twice when the event beats the response', async () => {
      // The server emits `profiles.changed` with the whole list as it creates, and
      // that event routinely arrives first. Appending would offer the new profile
      // twice under one id. Found live, against a real gateway.
      const service = fakeService();
      const { store, realtime } = setUp(service);
      await store.load();

      const pending = store.create();
      realtime.emit('profiles.changed', {
        profiles: [
          { id: 'p1', name: null, isDefault: true },
          { id: 'p2', name: null, isDefault: false },
        ],
      });
      await pending;

      expect(store.profiles().map((entry) => entry.id)).toEqual(['p1', 'p2']);
    });
  });

  describe('deleting', () => {
    it('promotes the oldest remaining when the default goes', async () => {
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({ id: 'a', isDefault: true, position: 0 }),
            profile({ id: 'b', isDefault: false, position: 1 }),
            profile({ id: 'c', isDefault: false, position: 2 }),
          ],
        })
      );
      await store.load();

      expect(store.successorOf('a')?.id).toBe('b');
      await store.remove('a');

      expect(store.profiles().map((entry) => entry.id)).toEqual(['b', 'c']);
      expect(store.profiles().find((entry) => entry.isDefault)?.id).toBe('b');
    });

    it('names no successor for an ordinary profile', async () => {
      // Nothing changes hands, so the confirm copy has nothing to say about it.
      const { store } = setUp(
        fakeService({
          profiles: [
            profile({ id: 'a', isDefault: true }),
            profile({ id: 'b', isDefault: false }),
          ],
        })
      );
      await store.load();

      expect(store.successorOf('b')).toBeNull();
    });
  });

  describe('profiles.changed', () => {
    it('applies the whole list a second device sent', async () => {
      const { store, realtime } = setUp(fakeService());
      await store.load();

      realtime.emit('profiles.changed', {
        profiles: [
          { id: 'p1', name: 'Elsewhere', isDefault: true },
          { id: 'p9', name: 'The office', isDefault: false },
        ],
      });

      expect(store.profiles().map((entry) => entry.name)).toEqual([
        'Elsewhere',
        'The office',
      ]);
    });

    it('loses to a field somebody is still saving', async () => {
      // Plan 0004 section 7.2, case 3. Without this the half typed change is
      // overwritten by an echo of the state being edited.
      const service = fakeService();
      const { store, realtime } = setUp(service);
      await store.load();

      const pending = store.save('p1', 'name', { name: 'Mine' }, (current) => ({
        ...current,
        name: 'Mine',
      }));

      realtime.emit('profiles.changed', {
        profiles: [{ id: 'p1', name: 'Theirs', isDefault: true }],
      });

      expect(store.selected()?.name).toBe('Mine');
      await pending;
    });

    it('wins for a field nothing claims', async () => {
      const service = fakeService();
      const { store, realtime } = setUp(service);
      await store.load();

      const pending = store.save('p1', 'name', { name: 'Mine' }, (current) => ({
        ...current,
        name: 'Mine',
      }));

      realtime.emit('profiles.changed', {
        profiles: [
          {
            id: 'p1',
            name: 'Theirs',
            isDefault: true,
            addressText: 'Calle Mayor 12',
          },
        ],
      });

      expect(store.selected()?.addressText).toBe('Calle Mayor 12');
      await pending;
    });

    it('ignores a payload it cannot read rather than emptying the page', async () => {
      const { store, realtime } = setUp(fakeService());
      await store.load();

      realtime.emit('profiles.changed', { profiles: [] });

      expect(store.profiles()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('drops everything, because it holds where somebody lives', async () => {
      const { store } = setUp(fakeService());
      await store.load();

      store.clear();

      expect(store.profiles()).toEqual([]);
      expect(store.state()).toBe('loading');
      expect(store.chains()).toEqual([]);
    });
  });
});
