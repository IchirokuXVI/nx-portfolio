import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';

/**
 * The platform-admin gate (plan 0038, section 7).
 *
 * **Every subject on this service is gated**, not just the writes, which is the
 * one way it differs from catalog's identical looking class. Nothing the
 * harvester exposes is open to ordinary users: not the runs, not the discovered
 * places, not the source configuration. The only user facing addition that was
 * designed, a public per item refresh, went to backlog 0006 with its cooldown.
 */
@Injectable()
export class PlatformAdminService {
  private readonly adminIds: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.adminIds = new Set(
      config.getOrThrow<HarvesterConfig>('harvester').platformAdminUserIds
    );
  }

  isAdmin(userId: string): boolean {
    return this.adminIds.has(userId);
  }

  requireAdmin(userId: string): void {
    if (!this.isAdmin(userId)) {
      throw new ForbiddenException(
        'Only the app owner can operate the harvester'
      );
    }
  }
}
