import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { CatalogConfig } from '../config/app-config';

/**
 * The platform-admin gate (plan 0012, section 3). Catalog is owner curated: only
 * the app owner may write supermarkets, locations, items and per location prices.
 * "Owner" is a small allowlist of user ids (`PLATFORM_ADMIN_USER_IDS`), distinct
 * from a zone owner; this same role later powers the admin back office (the zone
 * usage listing deferred in plan 0006, section 7). Reads are open, so only the
 * write paths call {@link requireAdmin}.
 */
@Injectable()
export class PlatformAdminService {
  private readonly adminIds: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.adminIds = new Set(
      config.getOrThrow<CatalogConfig>('catalog').platformAdminUserIds
    );
  }

  isAdmin(userId: string): boolean {
    return this.adminIds.has(userId);
  }

  /** Throw unless the caller is the app owner. Called first by every write. */
  requireAdmin(userId: string): void {
    if (!this.isAdmin(userId)) {
      throw new ForbiddenException('Only the app owner can manage the catalog');
    }
  }
}
