import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PostalCodeDiscoveryStatus } from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
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

  /**
   * Every source answered. DONE means we looked, never that we found shops.
   *
   * `runId` is the **last** run the code produced and may be null, because a
   * code every source had already answered recently is done without starting
   * one (plan 0107, section 2.2). A null leaves whatever run the row already
   * names rather than erasing it.
   *
   * `requeuedAt` is cleared here and only here: the operator asked for a fresh
   * look, and every source has now given one.
   */
  async markDone(id: string, runId: string | null): Promise<void> {
    await this.requests.update(
      { id },
      {
        status: PostalCodeDiscoveryStatus.DONE,
        discoveredAt: new Date(),
        nextAttemptAt: null,
        error: null,
        requeuedAt: null,
        ...(runId === null ? {} : { runId }),
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

  /**
   * An operator adds one code by hand (plan 0097, section 6.1).
   *
   * The same upsert shape as {@link enqueue} and a different rule, because the
   * two are different acts: an announcement asks for a code to be looked at
   * eventually and must not disturb a row that already exists, while this is a
   * person pressing a button and expecting something to happen. So a `PARKED`,
   * `DONE` or `FAILED` row takes the operator's choice whatever the cooldown
   * says, and a `QUEUED` or `RUNNING` row is left alone because it is already
   * the answer.
   *
   * `discoverNow` false writes `PARKED`, which `claimNext` never reads.
   */
  async add(
    country: string,
    postalCode: string,
    discoverNow: boolean
  ): Promise<PostalCodeDiscoveryRequest> {
    const status = discoverNow
      ? PostalCodeDiscoveryStatus.QUEUED
      : PostalCodeDiscoveryStatus.PARKED;
    // `requeuedAt` is stamped only when the operator asked for a run. A parked
    // code has not been asked about yet, so it forces nothing (plan 0107,
    // section 2.1).
    await this.requests.query(
      `INSERT INTO "postal_code_discovery_requests"
         ("country", "postalCode", "status", "requestedAt", "requeuedAt")
       VALUES ($1, $2, $3, now(), CASE WHEN $4::boolean THEN now() END)
       ON CONFLICT ("country", "postalCode") DO UPDATE
          SET "status" = $3,
              "attempts" = 0,
              "nextAttemptAt" = NULL,
              "error" = NULL,
              "dismissed" = false,
              "requeuedAt" = CASE WHEN $4::boolean THEN now()
                                  ELSE "postal_code_discovery_requests"."requeuedAt"
                             END,
              "updatedAt" = now()
        WHERE "postal_code_discovery_requests"."status" IN
              ('DONE', 'FAILED', 'PARKED')`,
      [country, postalCode, status, discoverNow]
    );
    // Read the row back rather than trusting `RETURNING`, which answers nothing
    // when the conflict target matched and the WHERE clause refused the update.
    // A refused update is not a failure here: the code is already queued or
    // running, which is what the caller asked for.
    return this.byCode(country, postalCode);
  }

  /**
   * Discover it again, now (plan 0097, section 6.2).
   *
   * **It ignores the cooldown**, which is the whole reason it exists:
   * {@link enqueue} refuses a `DONE` row inside its thirty days by design, and
   * an operator who has just imported a chain wants to look again today.
   *
   * `requestedAt` is not moved, for the reason plan 0063 gives: it records when
   * the code was first asked about and the claim orders by it, so a requeued row
   * keeps its place in the queue rather than jumping to the back of it.
   *
   * **It queues, and it does not run.** The queue drains serially and the active
   * run index allows one run at a time, so the honest answer is that the row is
   * waiting.
   */
  async requeue(row: PostalCodeDiscoveryRequest): Promise<void> {
    await this.requests.update(
      { id: row.id },
      {
        status: PostalCodeDiscoveryStatus.QUEUED,
        attempts: 0,
        nextAttemptAt: null,
        error: null,
        dismissed: false,
        // What makes the cooldown yield, now that it is per source (plan 0107,
        // section 2.1). Without it a code every source answered last week would
        // find nothing due and go straight back to DONE.
        requeuedAt: new Date(),
      }
    );
  }

  /** Hide a row from the working set, keeping it (plan 0097, section 6.3). */
  async setDismissed(id: string, dismissed: boolean): Promise<void> {
    await this.requests.update({ id }, { dismissed });
  }

  /**
   * The name a run's geocode gave this code, if the code is in the queue.
   *
   * Matching no row is normal and not an error: an admin can spawn a
   * `STORE_DISCOVERY` run for a code nobody ever queued, and that run has a name
   * and no row to write it on.
   */
  async recordPlaceName(
    country: string,
    postalCode: string,
    placeName: string
  ): Promise<void> {
    await this.requests.update({ country, postalCode }, { placeName });
  }

  async byId(id: string): Promise<PostalCodeDiscoveryRequest> {
    const row = await this.requests.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('That postal code request does not exist');
    }
    return row;
  }

  private async byCode(
    country: string,
    postalCode: string
  ): Promise<PostalCodeDiscoveryRequest> {
    const row = await this.requests.findOne({
      where: { country, postalCode },
    });
    if (!row) {
      throw new NotFoundException('That postal code request does not exist');
    }
    return row;
  }

  /**
   * Counts by status, plus the oldest waiting row (plan 0097, section 7.1).
   *
   * One grouped query and one minimum rather than five counts, because the
   * screen shows them together and a queue big enough for five scans to matter
   * is a queue nobody is draining.
   */
  async summarize(): Promise<{
    byStatus: Record<PostalCodeDiscoveryStatus, number>;
    oldestQueuedAt: Date | null;
  }> {
    const rows: Array<{ status: PostalCodeDiscoveryStatus; count: string }> =
      await this.requests.query(
        `SELECT "status", COUNT(*)::text AS "count"
           FROM "postal_code_discovery_requests"
          GROUP BY "status"`
      );
    const byStatus = {
      [PostalCodeDiscoveryStatus.QUEUED]: 0,
      [PostalCodeDiscoveryStatus.RUNNING]: 0,
      [PostalCodeDiscoveryStatus.DONE]: 0,
      [PostalCodeDiscoveryStatus.FAILED]: 0,
      [PostalCodeDiscoveryStatus.PARKED]: 0,
    };
    for (const row of rows) {
      byStatus[row.status] = Number(row.count);
    }

    const [oldest]: Array<{ requestedAt: Date | null }> =
      await this.requests.query(
        `SELECT MIN("requestedAt") AS "requestedAt"
           FROM "postal_code_discovery_requests"
          WHERE "status" = 'QUEUED'`
      );
    return { byStatus, oldestQueuedAt: oldest?.requestedAt ?? null };
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
