import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { Item, ItemPrice, PriceScope } from '../entities';
import type { CatalogAuditService } from './catalog-audit.service';
import type { EffectivePriceService } from './effective-price.service';
import { ItemPriceService } from './item-price.service';
import type { PlatformAdminService } from './platform-admin.service';

const ITEM = '0b6b3a0e-6f0e-4c8e-9d4a-2f7f7f0b1c2d';
const SCOPE = '1c7c4b1f-7a1f-4d9f-8e5b-3a8a8a1c2d3e';

/**
 * Plan 0158: the admin price route took `USER_RECEIPT` and stored the row,
 * although its own description says the user kinds are refused. The gateway
 * DTO refuses them first, and the service refuses them again for any other
 * caller on the subject.
 */
describe('ItemPriceService.add', () => {
  function build() {
    const write = jest.fn();
    const items = { findOne: jest.fn() } as unknown as Repository<Item>;
    const scopes = { findOne: jest.fn() } as unknown as Repository<PriceScope>;
    const admin = {
      requireAdmin: jest.fn(async () => ({ userId: 'admin' })),
    } as unknown as PlatformAdminService;
    const audit = { write } as unknown as CatalogAuditService;
    const service = new ItemPriceService(
      {} as Repository<ItemPrice>,
      items,
      scopes,
      admin,
      audit,
      {} as EffectivePriceService
    );
    return { service, write, items };
  }

  it.each([PriceSourceKind.USER_RECEIPT, PriceSourceKind.USER_REPORTED])(
    'refuses %s before it reads or writes anything',
    async (sourceKind) => {
      const { service, write, items } = build();

      await expect(
        service.add({
          userId: 'admin',
          itemId: ITEM,
          priceScopeId: SCOPE,
          sourceKind,
          price: 1.25,
        })
      ).rejects.toBeInstanceOf(ValidationException);
      expect(items.findOne).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    }
  );
});
