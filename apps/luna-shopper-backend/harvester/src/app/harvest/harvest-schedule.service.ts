import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestScheduleBlock,
  type CreateHarvestScheduleRequest,
  type HarvestScheduleIdRequest,
  type HarvestScheduleLastRun,
  type HarvestSchedulePage,
  type HarvestScheduleView,
  type ListHarvestSchedulesRequest,
  type SetHarvestScheduleEnabledRequest,
  type UpdateHarvestScheduleRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ValidationException,
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '@portfolio/luna-shopper/platform';
import { In } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestSchedule } from '../entities';
import { HarvestRunPresetStore } from './harvest-run-preset.store';
import { HarvestRunService, SOURCE_FAILING_AFTER } from './harvest-run.service';
import { HarvestRunStore, type SourceRef } from './harvest-run.store';
import { HarvestScheduleStore } from './harvest-schedule.store';
import { toHarvestScheduleView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import {
  HARVEST_CLOCK,
  isKnownTimezone,
  nextSlot,
  type HarvestClock,
  type SlotRule,
} from './schedule-slot';

/** The zone a schedule reads its time in when the request names none. */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Madrid';

const TIME_OF_DAY = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TIMEZONE_MAX = 64;

/** The cursor of the list: the sort key, with `infinity` for a schedule that is off. */
interface ScheduleCursor {
  value: string;
  id: string;
}

/** The sort key of the list, which puts the schedules that are off last. */
const SORT_KEY = `COALESCE("s"."nextRunAt", 'infinity'::timestamptz)`;

/**
 * Schedules: a preset that starts by itself at a time of day (plan 0206,
 * sections 2 and 4).
 *
 * **A schedule is created or switched on only with
 * `acknowledgedAutomaticFetch: true`.** Plan 0038 defended the fetching with
 * "every request happens because a person asked", and a schedule ends that
 * for its chain. The owner decided that a scheduled crawl is acceptable when
 * the person who sets it up is warned, and this field is how the backend knows
 * the warning was drawn. Only a JSON `true` passes.
 *
 * A schedule can be created while the source row is off, while the scheduler
 * is off and while the preset would be refused. Each of those is a state that
 * changes, and `blockedBy` and `lastOutcome` report it, so the order of setup
 * does not matter.
 */
@Injectable()
export class HarvestScheduleService {
  constructor(
    private readonly store: HarvestScheduleStore,
    private readonly presets: HarvestRunPresetStore,
    private readonly runStore: HarvestRunStore,
    private readonly runs: HarvestRunService,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService,
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  /** Ordered by `nextRunAt`, with the schedules that are off last. */
  async list(req: ListHarvestSchedulesRequest): Promise<HarvestSchedulePage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ScheduleCursor | undefined;

    const qb = this.store
      .repository()
      .createQueryBuilder('s')
      .orderBy(SORT_KEY, 'ASC')
      .addOrderBy('"s"."id"', 'ASC')
      .limit(limit + 1);
    if (req.supermarketId) {
      qb.andWhere('"s"."supermarketId" = :sid', { sid: req.supermarketId });
    }
    if (req.presetId) {
      qb.andWhere('"s"."presetId" = :pid', { pid: req.presetId });
    }
    if (cursor) {
      qb.andWhere(`(${SORT_KEY}, "s"."id") > (:cv::timestamptz, :cid)`, {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(page),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              value: last.nextRunAt ? last.nextRunAt.toISOString() : 'infinity',
              id: last.id,
            })
          : null,
    };
  }

  async get(req: HarvestScheduleIdRequest): Promise<HarvestScheduleView> {
    await this.admin.requireAdmin(req);
    return this.view(await this.store.load(req.scheduleId));
  }

  async create(req: CreateHarvestScheduleRequest): Promise<HarvestScheduleView> {
    const userId = await this.admin.requireAdmin(req);
    requireAcknowledged(req.acknowledgedAutomaticFetch);
    const rule = validRule({
      timeOfDay: req.timeOfDay,
      daysOfWeek: req.daysOfWeek,
      timezone: req.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
    });
    const preset = await this.presets.load(req.presetId);
    const row = this.store.create({
      presetId: preset.id,
      // Copied, so the list filters by chain without reading the presets.
      supermarketId: preset.supermarketId,
      timeOfDay: rule.timeOfDay,
      daysOfWeek: [...rule.daysOfWeek],
      timezone: rule.timezone,
      enabled: true,
      nextRunAt: nextSlot(rule, this.clock()),
      lastSlotAttempts: 0,
      createdByUserId: userId,
      updatedByUserId: userId,
    });
    return this.view(await this.store.save(row));
  }

  /**
   * Change when a schedule fires. The preset never changes: to point at
   * another one, delete the schedule and create one.
   *
   * A schedule that is on gets its next slot again from now, so a time moved
   * earlier today does not fire a slot that has already passed.
   */
  async update(req: UpdateHarvestScheduleRequest): Promise<HarvestScheduleView> {
    const userId = await this.admin.requireAdmin(req);
    const row = await this.store.load(req.scheduleId);
    const rule = validRule({
      timeOfDay: req.timeOfDay ?? row.timeOfDay,
      daysOfWeek: req.daysOfWeek ?? row.daysOfWeek,
      timezone: req.timezone ?? row.timezone,
    });
    row.timeOfDay = rule.timeOfDay;
    row.daysOfWeek = [...rule.daysOfWeek];
    row.timezone = rule.timezone;
    if (row.enabled) {
      row.nextRunAt = nextSlot(rule, this.clock());
    }
    row.updatedByUserId = userId;
    return this.view(await this.store.save(row));
  }

  /**
   * Switch a schedule on or off (section 4.2). On takes the next slot from
   * now, and needs the acknowledgement a create needs. Off clears `nextRunAt`
   * and keeps `lastSlotAt` and the outcome as the history.
   */
  async setEnabled(
    req: SetHarvestScheduleEnabledRequest
  ): Promise<HarvestScheduleView> {
    const userId = await this.admin.requireAdmin(req);
    const row = await this.store.load(req.scheduleId);
    if (req.enabled === true) {
      requireAcknowledged(req.acknowledgedAutomaticFetch);
      row.enabled = true;
      row.nextRunAt = nextSlot(row, this.clock());
    } else {
      row.enabled = false;
      row.nextRunAt = null;
    }
    row.updatedByUserId = userId;
    return this.view(await this.store.save(row));
  }

  /** Delete a schedule. Its runs keep their record and still name it. */
  async delete(req: HarvestScheduleIdRequest): Promise<{ id: string }> {
    await this.admin.requireAdmin(req);
    await this.store.delete(req.scheduleId);
    return { id: req.scheduleId };
  }

  private async view(row: HarvestSchedule): Promise<HarvestScheduleView> {
    const [view] = await this.views([row]);
    return view;
  }

  /**
   * A page of schedules, each with its preset's name, its last run, what
   * blocks it and its estimate, in a fixed number of reads for the page.
   */
  private async views(
    rows: readonly HarvestSchedule[]
  ): Promise<HarvestScheduleView[]> {
    if (rows.length === 0) {
      return [];
    }
    const presets = await this.presets.repository().findBy({
      id: In(distinct(rows.map((row) => row.presetId))),
    });
    const presetById = new Map(presets.map((preset) => [preset.id, preset]));

    const runIds = distinct(rows.map((row) => row.lastRunId));
    const lastRuns =
      runIds.length === 0
        ? []
        : await this.runStore.repository().find({
            where: { id: In(runIds) },
            select: { id: true, status: true, requestedAt: true },
          });
    const runById = new Map<string, HarvestScheduleLastRun>(
      lastRuns.map((run) => [
        run.id,
        {
          id: run.id,
          status: run.status,
          requestedAt: run.requestedAt.toISOString(),
        },
      ])
    );

    const sources = await this.runStore.sourcesFor(
      [],
      distinct(rows.map((row) => row.supermarketId))
    );
    const sourceByChain = new Map(
      sources.map((source) => [source.supermarketId, source])
    );

    const estimates = await this.runs.estimates(
      rows.map((row) => ({
        presetId: row.presetId,
        supermarketId: row.supermarketId,
        // A preset cannot be deleted while a schedule names it, so this
        // fallback is for a row whose preset went another way.
        mode:
          presetById.get(row.presetId)?.input.mode ??
          HarvestRunMode.CATALOG_DISCOVERY,
      }))
    );

    return rows.map((row, index) =>
      toHarvestScheduleView(row, {
        presetName: presetById.get(row.presetId)?.name ?? row.presetId,
        lastRun: row.lastRunId ? (runById.get(row.lastRunId) ?? null) : null,
        blockedBy: this.blockedBy(
          sourceByChain.get(row.supermarketId) ?? null
        ),
        estimate: estimates[index],
      })
    );
  }

  /**
   * What stands in the way of the next slot as things are now (section 6),
   * the first that applies. It is answered for a schedule that is off too, so
   * a person can see it before switching one on.
   *
   * The order is the worker's: the source row before its failures, so a row
   * that is off and failing says it is off, which is the first thing to fix.
   */
  private blockedBy(source: SourceRef | null): HarvestScheduleBlock | null {
    const settings = this.settings();
    if (!settings.harvestEnabled) {
      return HarvestScheduleBlock.HARVEST_DISABLED;
    }
    if (!settings.schedulerEnabled) {
      return HarvestScheduleBlock.SCHEDULER_DISABLED;
    }
    if (!source || !source.enabled) {
      return HarvestScheduleBlock.SOURCE_DISABLED;
    }
    if (source.consecutiveFailures >= SOURCE_FAILING_AFTER) {
      return HarvestScheduleBlock.SOURCE_FAILING;
    }
    return null;
  }
}

/**
 * The consent of section 4.1. Only a JSON `true` passes: a string `"true"`, a
 * `1` or an absent field are all a client that did not draw the warning.
 */
function requireAcknowledged(value: unknown): void {
  if (value !== true) {
    throw new ValidationException(
      'acknowledgedAutomaticFetch must be true. A schedule fetches the chain ' +
        'with nobody asking, and the person who sets one up is told so first.',
      { details: { acknowledgedAutomaticFetch: 'must be true' } }
    );
  }
}

/**
 * The rule a create or an update states, checked (section 4.2): `HH:mm` on a
 * 24 hour clock, one to seven different days from 1 to 7, and a zone that
 * `Intl.DateTimeFormat` accepts. The days come back sorted.
 */
export function validRule(raw: {
  timeOfDay: unknown;
  daysOfWeek: unknown;
  timezone: unknown;
}): SlotRule {
  if (typeof raw.timeOfDay !== 'string' || !TIME_OF_DAY.test(raw.timeOfDay)) {
    throw new ValidationException(
      'timeOfDay must be HH:mm on a 24 hour clock, such as 03:00.',
      { details: { timeOfDay: 'must be HH:mm, 24 hour' } }
    );
  }
  const days = raw.daysOfWeek;
  if (
    !Array.isArray(days) ||
    days.length < 1 ||
    days.length > 7 ||
    !days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) ||
    new Set(days).size !== days.length
  ) {
    throw new ValidationException(
      'daysOfWeek must be one to seven different days, 1 for Monday to 7 for ' +
        'Sunday.',
      { details: { daysOfWeek: 'must be distinct numbers from 1 to 7' } }
    );
  }
  if (
    typeof raw.timezone !== 'string' ||
    raw.timezone.length > TIMEZONE_MAX ||
    !isKnownTimezone(raw.timezone)
  ) {
    throw new ValidationException(
      'timezone must be an IANA name, such as Europe/Madrid.',
      { details: { timezone: 'must be an IANA timezone name' } }
    );
  }
  return {
    timeOfDay: raw.timeOfDay,
    daysOfWeek: [...(days as number[])].sort((a, b) => a - b),
    timezone: raw.timezone,
  };
}

/** The ids that are set, each once. */
function distinct(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
