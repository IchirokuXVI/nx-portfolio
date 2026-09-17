import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  HarvestRunPresetInput,
  HarvestRunPresetLastRun,
  HarvestRunStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository } from 'typeorm';
import { HarvestRunPreset } from '../entities';

const PG_UNIQUE_VIOLATION = '23505';

/** The case insensitive name index the migration creates (plan 0120, section 2). */
const NAME_INDEX = 'uq_harvest_run_presets_name';

/**
 * Every read and write of a `harvest_run_presets` row, in one place.
 *
 * Its own class, like {@link HarvestRunStore}, so the preset surface and the run
 * surface both reach a preset without depending on each other: the preset
 * service validates through the run service, and the run service starts a run
 * from a preset it loads here.
 */
@Injectable()
export class HarvestRunPresetStore {
  constructor(
    @InjectRepository(HarvestRunPreset)
    private readonly presets: Repository<HarvestRunPreset>
  ) {}

  async load(presetId: string): Promise<HarvestRunPreset> {
    const row = await this.presets.findOne({ where: { id: presetId } });
    if (!row) {
      throw new NotFoundException('Harvest run preset not found');
    }
    return row;
  }

  /**
   * Insert a preset, letting the **database** decide whether the name is taken
   * in that chain, for the same reason the active run lock is an index: a check
   * first and an insert second loses the race by construction.
   */
  async create(input: {
    supermarketId: string;
    name: string;
    input: HarvestRunPresetInput;
    userId: string;
  }): Promise<HarvestRunPreset> {
    return this.saveNamed(
      this.presets.create({
        supermarketId: input.supermarketId,
        name: input.name,
        input: input.input,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      })
    );
  }

  /** Write a changed preset, with the same name refusal as {@link create}. */
  async update(row: HarvestRunPreset): Promise<HarvestRunPreset> {
    return this.saveNamed(row);
  }

  async delete(presetId: string): Promise<void> {
    const result = await this.presets.delete({ id: presetId });
    if (!result.affected) {
      throw new NotFoundException('Harvest run preset not found');
    }
  }

  /**
   * The latest run started from each preset, in one query (plan 0120, section 6).
   *
   * A preset with no run is absent from the map. Ties on `requestedAt` fall to
   * the id, so the answer does not change between two reads.
   */
  async lastRuns(
    presetIds: readonly string[]
  ): Promise<Map<string, HarvestRunPresetLastRun>> {
    const latest = new Map<string, HarvestRunPresetLastRun>();
    if (presetIds.length === 0) {
      return latest;
    }
    const rows: Array<{
      presetId: string;
      id: string;
      status: HarvestRunStatus;
      requestedAt: Date;
    }> = await this.presets.query(
      `SELECT DISTINCT ON (r."presetId")
              r."presetId"    AS "presetId",
              r.id            AS id,
              r.status        AS status,
              r."requestedAt" AS "requestedAt"
         FROM "harvest_runs" AS r
        WHERE r."presetId" = ANY($1::uuid[])
        ORDER BY r."presetId", r."requestedAt" DESC, r.id DESC`,
      [presetIds]
    );
    for (const row of rows) {
      latest.set(row.presetId, {
        id: row.id,
        status: row.status,
        requestedAt: new Date(row.requestedAt).toISOString(),
      });
    }
    return latest;
  }

  repository(): Repository<HarvestRunPreset> {
    return this.presets;
  }

  private async saveNamed(row: HarvestRunPreset): Promise<HarvestRunPreset> {
    try {
      return await this.presets.save(row);
    } catch (error) {
      if (!violates(error, NAME_INDEX)) {
        throw error;
      }
      const existing = await this.presets
        .createQueryBuilder('p')
        .where('p."supermarketId" = :sid', { sid: row.supermarketId })
        .andWhere('lower(p.name) = lower(:name)', { name: row.name })
        .getOne();
      // Naming the preset that holds the name, so the caller can open it
      // rather than guess which one differs only in case.
      throw new ConflictException(
        existing
          ? `This chain already has a preset named "${existing.name}": ` +
              `${existing.id}. Names are compared without case.`
          : 'This chain already has a preset with that name. Names are ' +
              'compared without case.'
      );
    }
  }
}

/** A unique violation on one named index. */
function violates(error: unknown, index: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driver = (
    error as { driverError?: { code?: string; constraint?: string } }
  ).driverError;
  return driver?.code === PG_UNIQUE_VIOLATION && driver.constraint === index;
}
