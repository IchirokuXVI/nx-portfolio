import { inject, Injectable } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  daysFromDraft,
  scheduleCadence,
  sortedDays,
  type ResourceGateway,
  type ResourceInput,
  type ResourcePage,
  type ResourceQuery,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ChainNames } from './chain-names';
import { HarvestShell } from './harvest-shell';

/**
 * One schedule, as the screens read it: the view of the harvester, what its
 * chain is called, and when it runs in words.
 *
 * `acknowledgedAutomaticFetch` is a field of the form that adds a schedule
 * and of nothing else. No row ever carries it: the consent is given in the act
 * of the save and is not kept (admin plan 0067, constraints).
 */
export type Schedule = Wire.HarvestHarvestScheduleView & {
  readonly chainName: string | null;
  /** "Mon, Wed, Fri at 06:00", in the language of the screen. */
  readonly cadence: string;
  readonly acknowledgedAutomaticFetch?: boolean;
};

/** The field of the consent, which a refusal is drawn under. */
export const CONSENT_FIELD = 'acknowledgedAutomaticFetch';

/**
 * The schedules of the harvester, as a resource (admin plan 0067, target 1).
 *
 * Hand written for the reason the chain sources are: the routes are the
 * harvester's and `HARVEST_SERVICE` already speaks them. **Every call here is
 * a call of that service**, and this file adds none of its own.
 *
 * **The consent goes out only in the act that gave it.** A create sends
 * `acknowledgedAutomaticFetch: true` when the box of that same form is ticked,
 * and refuses under the box when it is not, before any request. Turning a
 * schedule on sends it from the named action that asked the question. Nothing
 * here keeps it, so a second save asks again.
 */
@Injectable({ providedIn: 'root' })
export class SchedulesGateway implements ResourceGateway<Schedule> {
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _names = inject(ChainNames);
  private readonly _shell = inject(HarvestShell);
  private readonly _translator = inject(RokuTranslatorService);

  async list(query: ResourceQuery): Promise<ResourcePage<Schedule>> {
    const chain = query.filters?.['supermarketId'];
    let page: Wire.HarvestHarvestSchedulePage;
    try {
      page = await this._harvest.listSchedules({
        cursor: query.cursor,
        limit: query.limit,
        ...(typeof chain === 'string' && chain !== ''
          ? { supermarketId: chain }
          : {}),
      });
    } catch (error) {
      this._shell.observeFailure();
      throw error;
    }
    this._shell.observeReachable();

    await this._resolve(page.items.map((row) => row.supermarketId));
    return {
      items: page.items.map((row) => this._shown(row)),
      nextCursor: page.nextCursor,
    };
  }

  async read(id: string): Promise<Schedule> {
    const view = await this._harvest.readSchedule(id);
    await this._resolve([view.supermarketId]);
    return this._shown(view);
  }

  /**
   * Add a schedule. Refused under the box, with no request, while the box is
   * not ticked.
   */
  async create(input: ResourceInput): Promise<Schedule> {
    if (input[CONSENT_FIELD] !== true) {
      throw this._refusal(CONSENT_FIELD, 'harvest.schedules.consent.missing');
    }

    const timezone = input['timezone'];
    const view = await this._harvest.createSchedule({
      presetId: String(input['presetId'] ?? ''),
      timeOfDay: String(input['timeOfDay'] ?? ''),
      daysOfWeek: daysFromDraft(input['daysOfWeek']),
      // Absent is Europe/Madrid, which is what the form shows for it.
      ...(typeof timezone === 'string' && timezone !== '' ? { timezone } : {}),
      acknowledgedAutomaticFetch: true,
    });
    await this._resolve([view.supermarketId]);
    return this._shown(view);
  }

  /** The time, the days and the timezone, whichever changed. */
  async update(id: string, input: ResourceInput): Promise<Schedule> {
    const patch: Wire.UpdateHarvestScheduleDto = {
      ...(typeof input['timeOfDay'] === 'string'
        ? { timeOfDay: input['timeOfDay'] }
        : {}),
      ...('daysOfWeek' in input
        ? { daysOfWeek: daysFromDraft(input['daysOfWeek']) }
        : {}),
      ...(typeof input['timezone'] === 'string' && input['timezone'] !== ''
        ? { timezone: input['timezone'] }
        : {}),
    };
    const view = await this._harvest.updateSchedule(id, patch);
    await this._resolve([view.supermarketId]);
    return this._shown(view);
  }

  async remove(id: string): Promise<void> {
    await this._harvest.deleteSchedule(id);
  }

  /**
   * Turn a schedule on or off. The named actions call this, after their
   * question, and nothing else changes `enabled`.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this._harvest.setScheduleEnabled(
      id,
      enabled ? { enabled, acknowledgedAutomaticFetch: true } : { enabled }
    );
  }

  private _shown(view: Wire.HarvestHarvestScheduleView): Schedule {
    const days = sortedDays(view.daysOfWeek);
    const cadence = scheduleCadence(
      { daysOfWeek: days, timeOfDay: view.timeOfDay },
      this._translator.locale()
    );
    return {
      ...view,
      daysOfWeek: days,
      chainName: this._names.known(view.supermarketId),
      cadence: this._translator.t(
        cadence.key,
        undefined,
        undefined,
        cadence.args
      ),
    };
  }

  /** A refusal about one field, in the shape the server refuses a field with. */
  private _refusal(field: string, key: string): GatewayError {
    return new GatewayError({
      code: 'validation_failed',
      status: 400,
      correlationId: '',
      fieldErrors: { [field]: [this._translator.t(key)] },
    });
  }

  /**
   * Name the chains, and wait for the words: a row carries its cadence as a
   * sentence, and a sentence made before the catalogue arrived is its key.
   * A lookup that fails costs a name, and not the read.
   */
  private async _resolve(ids: readonly string[]): Promise<void> {
    const words = firstValueFrom(this._translator.loaded$).catch(
      () => undefined
    );
    try {
      await this._names.resolve(ids);
    } catch {
      // `known` then answers `null`, and the chain is drawn as its ID.
    }
    await words;
  }
}
