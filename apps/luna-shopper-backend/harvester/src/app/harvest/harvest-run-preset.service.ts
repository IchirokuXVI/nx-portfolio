import { Injectable } from '@nestjs/common';
import {
  HarvestRunMode,
  type CreateHarvestRunPresetRequest,
  type HarvestRunPresetIdRequest,
  type HarvestRunPresetInput,
  type HarvestRunPresetPage,
  type HarvestRunPresetView,
  type ListHarvestRunPresetsRequest,
  type UpdateHarvestRunPresetRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ValidationException,
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '@portfolio/luna-shopper/platform';
import type { HarvestRunPreset } from '../entities';
import { HarvestRunPresetStore } from './harvest-run-preset.store';
import { HarvestRunService } from './harvest-run.service';
import { toHarvestRunPresetView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { SupermarketSourceService } from './supermarket-source.service';

/** The longest name a preset takes, which is the column's own length. */
const NAME_MAX = 80;

interface PresetCursor {
  name: string;
  id: string;
}

/**
 * Run requests saved under a name (plan 0120).
 *
 * **A preset is validated exactly as a spawn is**, by
 * {@link HarvestRunService.validateRequest}, and what it stores is the request
 * that validation resolved. So a preset that saves is a run that can start, as
 * long as nothing changed in between, and a preset that saved `details: NEW`
 * keeps saying `NEW` if the default ever changes.
 *
 * Starting a run from a preset is `HarvestRunService.spawnFromPreset`, which
 * validates it again. Nothing here changes a run: every run keeps its own copy
 * of the input.
 */
@Injectable()
export class HarvestRunPresetService {
  constructor(
    private readonly store: HarvestRunPresetStore,
    private readonly runs: HarvestRunService,
    private readonly sources: SupermarketSourceService,
    private readonly admin: PlatformAdminService
  ) {}

  async list(req: ListHarvestRunPresetsRequest): Promise<HarvestRunPresetPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as PresetCursor | undefined;

    const qb = this.store
      .repository()
      .createQueryBuilder('p')
      .orderBy('p.name', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .take(limit + 1);
    if (req.supermarketId) {
      qb.andWhere('p."supermarketId" = :sid', { sid: req.supermarketId });
    }
    if (cursor) {
      qb.andWhere('(p.name, p.id) > (:cn, :cid)', {
        cn: cursor.name,
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
        hasMore && last ? encodeCursor({ name: last.name, id: last.id }) : null,
    };
  }

  async get(req: HarvestRunPresetIdRequest): Promise<HarvestRunPresetView> {
    await this.admin.requireAdmin(req);
    return this.view(await this.store.load(req.presetId));
  }

  async create(
    req: CreateHarvestRunPresetRequest
  ): Promise<HarvestRunPresetView> {
    const userId = await this.admin.requireAdmin(req);
    const name = presetName(req.name);
    const input = await this.validated(req.supermarketId, req.input);
    return this.view(
      await this.store.create({
        supermarketId: req.supermarketId,
        name,
        input,
        userId,
      })
    );
  }

  /**
   * Rename a preset, replace its input, or both. `input` is replaced whole and
   * validated again; the chain never changes, because a request that fits one
   * chain's scopes names nothing of another's.
   */
  async update(
    req: UpdateHarvestRunPresetRequest
  ): Promise<HarvestRunPresetView> {
    const userId = await this.admin.requireAdmin(req);
    const row = await this.store.load(req.presetId);
    if (req.name !== undefined) {
      row.name = presetName(req.name);
    }
    if (req.input !== undefined) {
      row.input = await this.validated(row.supermarketId, req.input);
    }
    row.updatedByUserId = userId;
    return this.view(await this.store.update(row));
  }

  /**
   * Delete a preset. Its runs are left as they were: each keeps its own input
   * and still names the preset it came from.
   */
  async delete(req: HarvestRunPresetIdRequest): Promise<{ id: string }> {
    await this.admin.requireAdmin(req);
    await this.store.delete(req.presetId);
    return { id: req.presetId };
  }

  /**
   * The request a spawn would accept, resolved to what the preset stores.
   *
   * Two refusals come before the spawn's own validation, because they are about
   * what a preset is rather than about the request: a file import needs a
   * document uploaded at the time, and a discovery around a postal code belongs
   * to no chain.
   */
  private async validated(
    supermarketId: string,
    input: HarvestRunPresetInput
  ): Promise<HarvestRunPresetInput> {
    if (input.mode === HarvestRunMode.FILE_IMPORT) {
      throw new ValidationException(
        'A FILE_IMPORT cannot be saved as a preset, because it needs a ' +
          'document uploaded at the time it starts.'
      );
    }
    const request = { ...input, supermarketId };
    const source = await this.sources.findBySupermarket(supermarketId);
    const { supermarketId: chain, request: resolved } =
      await this.runs.validateRequest(request, source);
    if (!chain) {
      throw new ValidationException(
        'A store discovery around a postal code belongs to no chain, so it ' +
          'cannot be saved as a preset. Only a chain that publishes its own ' +
          'shop list runs a store discovery a preset can hold.'
      );
    }
    return resolved;
  }

  private async view(row: HarvestRunPreset): Promise<HarvestRunPresetView> {
    const [view] = await this.views([row]);
    return view;
  }

  private async views(
    rows: readonly HarvestRunPreset[]
  ): Promise<HarvestRunPresetView[]> {
    const latest = await this.store.lastRuns(rows.map((row) => row.id));
    return rows.map((row) =>
      toHarvestRunPresetView(row, latest.get(row.id) ?? null)
    );
  }
}

/** A trimmed name, refused when it is empty or longer than the column. */
function presetName(raw: string): string {
  const name = String(raw ?? '').trim();
  if (name === '') {
    throw new ValidationException('A preset needs a name.');
  }
  if (name.length > NAME_MAX) {
    throw new ValidationException(
      `A preset name is ${NAME_MAX} characters at most.`
    );
  }
  return name;
}
