import {
  ItemSourceMatch,
  SourceLocationStatus,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { SourceLocation } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceLocationService } from './source-location.service';

const ADMIN = 'owner-1';
const CHAIN = 'chain-deza';

function makeAdmin(): jest.Mocked<PlatformAdminService> {
  return {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return credential.userId;
    }),
  } as unknown as jest.Mocked<PlatformAdminService>;
}

function catalogLocation(
  id: string,
  label: string | null,
  address: string | null = null,
  supermarketId = CHAIN
): SupermarketLocationView {
  return {
    id,
    supermarketId,
    priceScopeId: 'scope-1',
    label: label === null ? null : { es: label },
    address,
    city: null,
    country: null,
    postalCode: null,
    postalCodeSource: null,
    latitude: null,
    longitude: null,
    externalRef: null,
    externalProvider: null,
  };
}

function heldRow(overrides: Partial<SourceLocation> = {}): SourceLocation {
  return {
    id: 'sl-1',
    supermarketId: CHAIN,
    externalId: 'T1',
    printedName: 'Ronda del Marrubial',
    supermarketLocationId: 'loc-marrubial',
    status: SourceLocationStatus.ACTIVE,
    matchedBy: ItemSourceMatch.NAME_SIZE,
    firstSeenAt: new Date('2026-08-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-08-01T00:00:00.000Z'),
    firstRunId: 'run-0',
    lastRunId: 'run-0',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SourceLocation;
}

function build(
  options: {
    held?: SourceLocation[];
    catalogLocations?: SupermarketLocationView[];
    one?: SourceLocation | null;
  } = {}
) {
  const { held = [], catalogLocations = [], one } = options;
  const saved: SourceLocation[] = [];

  const shops = {
    find: jest.fn(async () => held),
    findOne: jest.fn(async () => (one === undefined ? (held[0] ?? null) : one)),
    create: jest.fn((draft) => ({ id: 'sl-new', ...draft })),
    save: jest.fn(async (input: SourceLocation | SourceLocation[]) => {
      saved.push(...(Array.isArray(input) ? input : [input]));
      return input;
    }),
  } as unknown as Repository<SourceLocation>;

  const catalog = {
    listSupermarketLocations: jest.fn(async () => ({
      items: catalogLocations,
      nextCursor: null,
    })),
    getSupermarketLocation: jest.fn(
      async (id: string) =>
        catalogLocations.find((l) => l.id === id) ??
        catalogLocation(id, 'somewhere else', null, 'chain-other')
    ),
  } as unknown as jest.Mocked<CatalogClient>;

  const svc = new SourceLocationService(shops, catalog, makeAdmin());
  return { svc, shops, catalog, saved };
}

/**
 * Which shop of theirs is which of ours (plan 0084, section 6).
 */
describe('SourceLocationService.observe', () => {
  /**
   * The default is an exact name match and nothing cleverer, against the
   * chain's location labels and addresses through the same `normalizeName`
   * everything else uses.
   */
  it('maps a shop on exactly one hit', async () => {
    const { svc, saved } = build({
      catalogLocations: [
        catalogLocation('loc-marrubial', 'Ronda del Marrubial'),
        catalogLocation('loc-centro', 'Centro'),
      ],
    });
    await svc.observe(
      CHAIN,
      [{ externalId: 'T1', printedName: 'RONDA DEL MARRUBIÁL' }],
      'run-1'
    );
    expect(saved[0]).toMatchObject({
      externalId: 'T1',
      supermarketLocationId: 'loc-marrubial',
      status: SourceLocationStatus.ACTIVE,
      matchedBy: ItemSourceMatch.NAME_SIZE,
      firstRunId: 'run-1',
    });
  });

  it('leaves a shop unmapped on no hit', async () => {
    const { svc, saved } = build({
      catalogLocations: [catalogLocation('loc-centro', 'Centro')],
    });
    await svc.observe(
      CHAIN,
      [{ externalId: 'Z1', printedName: 'Zoco' }],
      'run-1'
    );
    expect(saved[0]).toMatchObject({
      supermarketLocationId: null,
      status: SourceLocationStatus.UNMAPPED,
    });
  });

  /**
   * Two of ours answering to one of theirs is precisely the case where guessing
   * does harm, so it goes to the queue rather than to whichever row came first.
   */
  it('leaves a shop unmapped when two of ours answer to the name', async () => {
    const { svc, saved } = build({
      catalogLocations: [
        catalogLocation('loc-a', 'Centro'),
        catalogLocation('loc-b', 'centro'),
      ],
    });
    await svc.observe(
      CHAIN,
      [{ externalId: 'C1', printedName: 'Centro' }],
      'run-1'
    );
    expect(saved[0]).toMatchObject({
      supermarketLocationId: null,
      status: SourceLocationStatus.UNMAPPED,
    });
  });

  /** One location under two names is one shop, not an ambiguity. */
  it('counts a location that matches by label and by address once', async () => {
    const { svc, saved } = build({
      catalogLocations: [
        catalogLocation('loc-a', 'Ronda del Marrubial', 'Ronda del Marrubial'),
      ],
    });
    await svc.observe(
      CHAIN,
      [{ externalId: 'T1', printedName: 'Ronda del Marrubial' }],
      'run-1'
    );
    expect(saved[0]).toMatchObject({
      supermarketLocationId: 'loc-a',
      status: SourceLocationStatus.ACTIVE,
    });
  });

  /**
   * **This is the test that states why the key is the code.** A mapping keyed on
   * the display name would detach the day marketing retitles a shop, and detach
   * into `UNMAPPED`, which reads as "they closed it".
   */
  it('keeps the mapping when the chain renames the shop', async () => {
    const { svc, saved, catalog } = build({
      held: [heldRow()],
      catalogLocations: [
        catalogLocation('loc-marrubial', 'Ronda del Marrubial'),
      ],
    });
    await svc.observe(
      CHAIN,
      [{ externalId: 'T1', printedName: 'Marrubial Express' }],
      'run-2'
    );
    expect(saved[0]).toMatchObject({
      supermarketLocationId: 'loc-marrubial',
      status: SourceLocationStatus.ACTIVE,
      printedName: 'Marrubial Express',
      lastRunId: 'run-2',
    });
    // Nothing was re-matched, so nothing was even read from catalog.
    expect(catalog.listSupermarketLocations).not.toHaveBeenCalled();
  });

  /**
   * A run never re-decides a row a person decided. Re-matching would undo an
   * `unmap` and drag an `IGNORED` shop back into the queue every crawl.
   */
  it('does not re-match a shop an operator unmapped or ignored', async () => {
    const { svc, saved } = build({
      held: [
        heldRow({
          status: SourceLocationStatus.IGNORED,
          supermarketLocationId: null,
        }),
      ],
      catalogLocations: [
        catalogLocation('loc-marrubial', 'Ronda del Marrubial'),
      ],
    });
    await svc.observe(
      CHAIN,
      [{ externalId: 'T1', printedName: 'Ronda del Marrubial' }],
      'run-2'
    );
    expect(saved[0]).toMatchObject({
      status: SourceLocationStatus.IGNORED,
      supermarketLocationId: null,
    });
  });
});

describe('SourceLocationService, the queue actions', () => {
  it('is gated to the platform admin', async () => {
    const { svc } = build({ held: [heldRow()] });
    await expect(
      svc.list({ userId: 'intruder', supermarketId: CHAIN })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('binds a row by hand and says a person did it', async () => {
    const { svc, saved } = build({
      held: [
        heldRow({
          status: SourceLocationStatus.UNMAPPED,
          supermarketLocationId: null,
        }),
      ],
      catalogLocations: [catalogLocation('loc-zoco', 'Zoco')],
    });
    const view = await svc.map({
      userId: ADMIN,
      sourceLocationId: 'sl-1',
      supermarketLocationId: 'loc-zoco',
    });
    expect(view).toMatchObject({
      supermarketLocationId: 'loc-zoco',
      status: SourceLocationStatus.ACTIVE,
      matchedBy: ItemSourceMatch.MANUAL,
    });
    expect(saved).toHaveLength(1);
  });

  /** A uuid from a picker is not evidence that the shop belongs to the chain. */
  it('refuses a location belonging to another chain', async () => {
    const { svc } = build({ held: [heldRow()] });
    await expect(
      svc.map({
        userId: ADMIN,
        sourceLocationId: 'sl-1',
        supermarketLocationId: 'loc-elsewhere',
      })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('unmaps back to the queue and drops the manual binding', async () => {
    const { svc } = build({
      held: [heldRow({ matchedBy: ItemSourceMatch.MANUAL })],
    });
    const view = await svc.unmap({ userId: ADMIN, sourceLocationId: 'sl-1' });
    expect(view).toMatchObject({
      supermarketLocationId: null,
      status: SourceLocationStatus.UNMAPPED,
      matchedBy: ItemSourceMatch.NAME_SIZE,
    });
  });

  it('ignores a place we do not sell from, and takes it back', async () => {
    const { svc } = build({ held: [heldRow()] });
    expect(
      await svc.ignore({ userId: ADMIN, sourceLocationId: 'sl-1' })
    ).toMatchObject({
      status: SourceLocationStatus.IGNORED,
      supermarketLocationId: null,
    });
    expect(
      await svc.unignore({ userId: ADMIN, sourceLocationId: 'sl-1' })
    ).toMatchObject({ status: SourceLocationStatus.UNMAPPED });
  });
});
