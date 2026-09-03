import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PostalCodeDiscoveryStatus } from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { PostalCodeDiscoveryRequest } from '../entities';

/** How long a code waits between attempts, doubling, capped (plan 0063, 4). */
const BACKOFF_BASE_SECONDS = 120;
const BACKOFF_CAP_SECONDS = 3600;

/**
 * Every read and write of a `postal_code_discovery_requests` row, in one place,
 * mirroring {@link HarvestRunStore} for the queue that stands beside the runs.
 *
 * Two of its methods are single statements on purpose and must stay that way:
 *
 * - {@link enqueue} is one `INSERT ... ON CONFLICT`, because the racing writers
 *   are two ordinary profile saves by two people in the same street, and a read
 *   then an insert loses that race by construction (section 3).
 * - {@link claimNext} is one `UPDATE ... FOR UPDATE SKIP LOCKED`, so two
 *   harvester replicas draining at once cannot claim the same row, and neither
 *   waits on the other to find out.
 */
@Injectable()
export class PostalCodeDiscoveryStore {
  private readonly logger = new Logger(PostalCodeDiscoveryStore.name);

  constructor(
    @InjectRepository(PostalCodeDiscoveryRequest)
    private readonly requests: Repository<PostalCodeDiscoveryRequest>
  ) {}

  /**
   * Ask for a code to be discovered, once.
   *
   * The upsert **leaves an existing row alone unless the cooldown has expired**
   * (section 4), which is the whole of the deduplication rule:
   *
   * - a QUEUED or RUNNING row is already the answer, so nothing changes;
   * - a DONE row inside its cooldown is a no op, so a thousand users in one
   *   postcode produce one run a month between them;
   * - a DONE or FAILED row past the cooldown goes back to QUEUED with its
   *   attempt count reset, because a month later a transient failure and a
   *   permanently bad code are again distinguishable only by trying.
   *
   * `requestedAt` is deliberately not moved by a re queue: it records when the
   * code was first asked about, and the claim orders by it so the oldest waiting
   * code goes first.
   *
   * @returns true when this call left the code waiting for the worker.
   */
  async enqueue(
    country: string,
    postalCode: string,
    cooldownDays: number
  ): Promise<boolean> {
    const rows: Array<{ id: string }> = await this.requests.query(
      `INSERT INTO "postal_code_discovery_requests"
         ("country", "postalCode", "status", "requestedAt")
       VALUES ($1, $2, 'QUEUED', now())
       ON CONFLICT ("country", "postalCode") DO UPDATE
          SET "status" = 'QUEUED',
              "attempts" = 0,
              "nextAttemptAt" = NULL,
              "error" = NULL,
              "updatedAt" = now()
        WHERE "postal_code_discovery_requests"."status" IN ('DONE', 'FAILED')
          AND COALESCE(
                "postal_code_discovery_requests"."discoveredAt",
                "postal_code_discovery_requests"."lastAttemptedAt"
              ) < now() - ($3 || ' days')::interval
       RETURNING "id"`,
      [country, postalCode, String(cooldownDays)]
    );
    return rows.length > 0;
  }

  /**
   * Take the oldest due row and mark it RUNNING, or answer null.
   *
   * `SKIP LOCKED` rather than a lock wait: a second replica that finds this row
   * taken should go and look for another one, not queue up behind it. The
   * attempt is counted here rather than on the way out, so a worker that dies
   * mid run cannot retry forever.
   */
  async claimNext(): Promise<PostalCodeDiscoveryRequest | null> {
    // An UPDATE answers `[rows, rowCount]` through TypeORM's postgres driver,
    // where an INSERT answers the rows alone. Reading `[0]` off the wrong shape
    // gets an array that is truthy and has none of the columns, so the two are
    // destructured differently here on purpose.
    const [rows]: [PostalCodeDiscoveryRequest[], number] =
      await this.requests.query(
        `UPDATE "postal_code_discovery_requests" AS q
          SET "status" = 'RUNNING',
              "attempts" = q."attempts" + 1,
              "lastAttemptedAt" = now(),
              "nextAttemptAt" = NULL,
              "updatedAt" = now()
        WHERE q."id" = (
          SELECT c."id"
            FROM "postal_code_discovery_requests" AS c
           WHERE c."status" = 'QUEUED'
             AND (c."nextAttemptAt" IS NULL OR c."nextAttemptAt" <= now())
           ORDER BY c."requestedAt" ASC, c."id" ASC
           LIMIT 1
             FOR UPDATE SKIP LOCKED
        )
        RETURNING q.*`
      );
    return rows[0] ?? null;
  }

  /** The run finished. DONE means we looked, never that we found shops. */
  async markDone(id: string, runId: string): Promise<void> {
    await this.requests.update(
      { id },
      {
        status: PostalCodeDiscoveryStatus.DONE,
        discoveredAt: new Date(),
        nextAttemptAt: null,
        error: null,
        runId,
      }
    );
  }

  /**
   * The attempt did not work. Back off and try again, or give up.
   *
   * A failure does not earn the full cooldown (section 4): Nominatim returning
   * nothing for a code and Overpass timing out are a transient state and a
   * permanently bad code, and the two are distinguishable only by trying again.
   * Out of attempts leaves the row FAILED **with its reason**, for the queue in
   * backlog 0009 to show somebody, because a code that cannot be geocoded at all
   * usually means the postal code is wrong rather than that the internet is
   * broken.
   */
  async markAttemptFailed(
    row: PostalCodeDiscoveryRequest,
    reason: string,
    maxAttempts: number,
    runId: string | null
  ): Promise<void> {
    const exhausted = row.attempts >= maxAttempts;
    if (exhausted) {
      this.logger.warn(
        `Postal code ${row.country}/${row.postalCode} failed discovery ` +
          `${row.attempts} time(s) and is being left FAILED: ${reason}`
      );
    }
    await this.requests.update(
      { id: row.id },
      {
        status: exhausted
          ? PostalCodeDiscoveryStatus.FAILED
          : PostalCodeDiscoveryStatus.QUEUED,
        nextAttemptAt: exhausted ? null : backoffFrom(row.attempts),
        error: reason,
        runId: runId ?? row.runId,
      }
    );
  }

  /**
   * Put a claimed row back without spending an attempt on it.
   *
   * For the case where the row was fine and the moment was not: another run
   * holds the active run lock, or the process is shutting down. Neither is
   * anything the code did, so neither may count against its attempt budget.
   */
  async release(row: PostalCodeDiscoveryRequest): Promise<void> {
    await this.requests.update(
      { id: row.id },
      {
        status: PostalCodeDiscoveryStatus.QUEUED,
        attempts: Math.max(0, row.attempts - 1),
        nextAttemptAt: null,
      }
    );
  }

  /**
   * A RUNNING row whose worker died. The run itself is reaped by the stale
   * reaper that already exists; this releases the queue row beside it, so a
   * force killed harvester does not leave a code claimed forever.
   */
  async reapStale(olderThanSeconds: number): Promise<number> {
    const [, reaped]: [unknown[], number] = await this.requests.query(
      `UPDATE "postal_code_discovery_requests"
          SET "status" = 'QUEUED',
              "nextAttemptAt" = NULL,
              "error" = 'The worker stopped without finishing; requeued.',
              "updatedAt" = now()
        WHERE "status" = 'RUNNING'
          AND "lastAttemptedAt" < now() - ($1 || ' seconds')::interval`,
      [String(olderThanSeconds)]
    );
    if (reaped > 0) {
      this.logger.warn(`Requeued ${reaped} abandoned discovery request(s)`);
    }
    return reaped;
  }

  repository(): Repository<PostalCodeDiscoveryRequest> {
    return this.requests;
  }
}

/**
 * Exponential, from two minutes, capped at an hour. Exported for the spec, which
 * asserts the shape rather than restating the arithmetic.
 */
export function backoffSeconds(attempts: number): number {
  const grown = BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempts - 1);
  return Math.min(grown, BACKOFF_CAP_SECONDS);
}

function backoffFrom(attempts: number): Date {
  return new Date(Date.now() + backoffSeconds(attempts) * 1000);
}
