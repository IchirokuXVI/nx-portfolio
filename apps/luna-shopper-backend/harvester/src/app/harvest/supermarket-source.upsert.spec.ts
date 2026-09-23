import type { ConfigService } from '@nestjs/config';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { SupermarketSource } from '../entities';
import type { HarvestRunStore } from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * Which adapters a source row may be written with (plan 0153).
 *
 * OpenStreetMap is asked for every postal code whatever the rows say, so a
 * row for it switches nothing on. Plan 0150 told an operator to enable one,
 * and nothing happened.
 */
describe('SupermarketSourceService.upsert', () => {
  const CHAIN = '11111111-1111-4111-8111-111111111111';

  function build() {
    const sources = {
      findOne: jest.fn(async () => null),
      create: jest.fn((fields: Partial<SupermarketSource>) => ({ ...fields })),
      save: jest.fn(async (row: SupermarketSource) => ({
        ...row,
        id: 'source-1',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastRunAt: null,
      })),
    } as unknown as Repository<SupermarketSource>;

    const admin = {
      requireAdmin: jest.fn(async () => 'owner-1'),
    } as unknown as PlatformAdminService;

    const config = {
      getOrThrow: jest.fn(() => ({
        defaultWorkers: 4,
        defaultMaxRequestsPerSecond: 4,
      })),
    } as unknown as ConfigService;

    return {
      sources,
      service: new SupermarketSourceService(
        sources,
        admin,
        config,
        {} as HarvestRunStore
      ),
    };
  }

  it('refuses osm-places and writes nothing', async () => {
    const { service, sources } = build();

    await expect(
      service.upsert({
        userId: 'owner-1',
        supermarketId: CHAIN,
        adapterKey: 'osm-places',
      })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(sources.save).not.toHaveBeenCalled();
  });

  it('writes a row for an adapter a run can use', async () => {
    const { service, sources } = build();

    await service.upsert({
      userId: 'owner-1',
      supermarketId: CHAIN,
      adapterKey: 'lidl-api',
    });

    expect(sources.save).toHaveBeenCalledWith(
      expect.objectContaining({ adapterKey: 'lidl-api', enabled: false })
    );
  });
});
