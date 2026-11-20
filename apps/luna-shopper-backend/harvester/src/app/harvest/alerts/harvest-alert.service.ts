import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  HarvestTestAlertView,
  SendHarvestTestAlertRequest,
} from '@portfolio/luna-shopper/contracts';
import { randomUUID } from 'node:crypto';
import type { HarvesterConfig } from '../../config/app-config';
import { PlatformAdminService } from '../platform-admin.service';
import { HARVEST_CLOCK, type HarvestClock } from '../schedule-slot';
import { smtpConfigured } from './alert-mailer';
import { testAlertFor } from './harvest-alert.rules';
import { HarvestAlertStore } from './harvest-alert.store';

/**
 * The test alert (plan 0218, section 7): one `TEST` row, which the worker
 * sends within 30 seconds like any other.
 *
 * It exists because an alert path that nobody has seen deliver is a trap: a
 * mail can land in spam, and the first real failure is the wrong moment to
 * learn it. The answer says whether the row will be sent or suppressed, and
 * never the address.
 */
@Injectable()
export class HarvestAlertService {
  constructor(
    private readonly admin: PlatformAdminService,
    private readonly store: HarvestAlertStore,
    private readonly config: ConfigService,
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock
  ) {}

  async sendTest(
    req: SendHarvestTestAlertRequest
  ): Promise<HarvestTestAlertView> {
    const userId = await this.admin.requireAdmin(req);
    const at = this.clock();
    const queued = await this.store.queue(
      testAlertFor({ id: randomUUID(), userId, at })
    );
    if (!queued) {
      // A fresh uuid in the key cannot collide, so this is not a state a
      // person can reach.
      throw new Error('The test alert was not queued.');
    }
    const settings =
      this.config.getOrThrow<HarvesterConfig>('harvester').alerts;
    return {
      id: queued.id,
      queuedAt: queued.createdAt.toISOString(),
      recipientConfigured: settings.recipients.length > 0,
      smtpConfigured: smtpConfigured(settings),
    };
  }
}
