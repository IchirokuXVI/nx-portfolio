import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  RECONCILIATION_PATTERNS,
  UserKind,
  type UsersWithoutMembershipsRequest,
  type UsersWithoutMembershipsResponse,
} from '@portfolio/luna-shopper/contracts';
import { Logger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { DataSource, LessThan } from 'typeorm';
import type { AuthConfig } from '../config/app-config';
import { User } from '../entities';
import { NATS_EVENTS } from '../events/identity-events.publisher';
import { IdentityService } from '../identity/identity.service';

/**
 * Orphan temporary-user reaper (plan 0011, section 3). A temporary user is minted
 * only when someone creates or joins a zone; if that membership is later removed
 * (or the join was abandoned), the throwaway account is left holding nothing. This
 * job periodically deletes temporary users that are older than a grace period and
 * hold no zone membership. Core is the authority on membership, so the job asks it
 * which aged candidates are truly memberless before deleting them.
 *
 * It is a self-contained interval loop (no `@nestjs/schedule` dependency), matching
 * the raw-timer style used elsewhere in the backend: `unref`ed so it never keeps
 * the process alive, non-overlapping, and cleared on shutdown.
 */
@Injectable()
export class OrphanUserReaperService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cfg: AuthConfig['reaper'];
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(NATS_EVENTS) private readonly client: ClientProxy,
    private readonly identity: IdentityService,
    private readonly logger: Logger,
    configService: ConfigService
  ) {
    this.cfg = configService.getOrThrow<AuthConfig>('auth').reaper;
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.enabled) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.cfg.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.reap();
    } catch (err) {
      this.logger.error({ err }, 'orphan-user reaper failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Delete one batch of aged, memberless temporary users. Returns how many were
   * deleted. Public so it can be unit tested and, later, triggered on demand.
   */
  async reap(): Promise<number> {
    const cutoff = new Date(Date.now() - this.cfg.graceMs);
    const candidates = await this.dataSource.getRepository(User).find({
      where: { kind: UserKind.TEMPORARY, createdAt: LessThan(cutoff) },
      take: this.cfg.batchSize,
    });
    if (candidates.length === 0) {
      return 0;
    }

    const ids = candidates.map((u) => u.id);
    const { userIds } = await firstValueFrom(
      this.client.send<
        UsersWithoutMembershipsResponse,
        UsersWithoutMembershipsRequest
      >(RECONCILIATION_PATTERNS.usersWithoutMemberships, { userIds: ids })
    );

    for (const userId of userIds) {
      // deleteAccount emits user.deleted and is idempotent, so a concurrent run
      // or a redelivery is harmless.
      await this.identity.deleteAccount({ userId });
    }
    if (userIds.length > 0) {
      this.logger.log(
        { count: userIds.length },
        'orphan-user reaper removed memberless temporary users'
      );
    }
    return userIds.length;
  }
}
