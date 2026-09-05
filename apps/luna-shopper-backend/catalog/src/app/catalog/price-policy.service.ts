import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  ListPricePoliciesRequest,
  PricePolicyListView,
  PricePolicyView,
  UpdatePricePolicyRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { PricePolicy } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toPricePolicyView } from './catalog.mappers';
import { EffectivePriceService } from './effective-price.service';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The policy per source kind (plan 0080, section 3). Six rows, seeded by the
 * migration, owner editable, platform admin gated both ways: the list is not
 * secret, but it is reached through the back office and nowhere else.
 *
 * A change recomputes every materialized row, which is a full pass of
 * `supermarket_items` and rare enough to be a synchronous loop behind the
 * update, inside its transaction.
 */
@Injectable()
export class PricePolicyService {
  constructor(
    @InjectRepository(PricePolicy)
    private readonly policies: Repository<PricePolicy>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService,
    private readonly effective: EffectivePriceService
  ) {}

  async list(req: ListPricePoliciesRequest): Promise<PricePolicyListView> {
    await this.admin.requireAdmin(req);
    const rows = await this.policies.find({
      order: { priority: 'ASC', sourceKind: 'ASC' },
    });
    return { items: rows.map(toPricePolicyView) };
  }

  async update(req: UpdatePricePolicyRequest): Promise<PricePolicyView> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.policies.findOne({
      where: { sourceKind: req.sourceKind },
    });
    if (!row) {
      throw new NotFoundException('Price policy not found');
    }
    const before = { ...row };
    if (req.priority !== undefined) {
      if (!Number.isInteger(req.priority)) {
        throw new ValidationException('priority must be an integer', {
          details: { priority: 'must be an integer' },
        });
      }
      row.priority = req.priority;
    }
    if (req.maxAgeDays !== undefined) {
      if (
        req.maxAgeDays !== null &&
        (!Number.isInteger(req.maxAgeDays) || req.maxAgeDays < 1)
      ) {
        throw new ValidationException('maxAgeDays must be a positive integer', {
          details: { maxAgeDays: 'must be a positive integer, or null' },
        });
      }
      row.maxAgeDays = req.maxAgeDays;
    }
    if (req.enabled !== undefined) {
      row.enabled = req.enabled;
    }

    const saved = await this.audit.write(actor, async (tx) => {
      const written = await tx.update(PricePolicy, before, row);
      await this.effective.recomputeAll(tx.manager);
      return written;
    });
    return toPricePolicyView(saved);
  }
}
