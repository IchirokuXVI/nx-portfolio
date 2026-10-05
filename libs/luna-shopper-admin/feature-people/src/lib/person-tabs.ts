import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  RECORD_CONTEXT,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { ZoneRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';

/** One zone a person is in, as a row of the tab. */
export interface PersonZone {
  readonly id: string;
  readonly name: string;
  readonly path: readonly string[] | null;
  /**
   * The person's role there, as a key, or `null` when the zone's members could
   * not be read or do not name this person.
   */
  readonly roleKey: string | null;
  /** The person's state there, as a key, or `null` for the same reason. */
  readonly statusKey: string | null;
  /** Whether the person is in the zone today: let in, and not removed. */
  readonly inside: boolean;
}

/** How many zones the tab reads before it stops asking for more. */
const ZONE_LIMIT = 50;

/**
 * The Zones tab of a person (admin plan 0045, target 3): the zones this person
 * is in, each with their role and state there. A row opens the zone.
 *
 * **Two reads, and neither is a join.** People are in one database and zones
 * in another. The zones a person is in come from the zone listing, narrowed to
 * that person. A listing row does not say what the person is in the zone, so
 * each zone is then read for its members. A person is in a handful of zones,
 * and the reads are capped at the first {@link ZONE_LIMIT}.
 *
 * A zone whose members could not be read is still listed, with no role beside
 * it: which zones somebody is in is the answer this tab exists for.
 *
 * **It learns the person from `RECORD_CONTEXT`** (admin plan 0057). The page
 * builds the tab again for another person, so the ID is read once.
 */
@Component({
  selector: 'lib-person-zones-tab',
  imports: [RouterLink, RokuTranslatorPipe],
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
      }
      @case ('error') {
        <p class="state error" role="alert">
          {{ 'people.users.zonesUnavailable' | rokuT }}
          <button (click)="load()" class="button small" type="button">
            {{ 'resource.action.retry' | rokuT }}
          </button>
        </p>
      }
      @default {
        @if (zones().length === 0) {
          <p class="state">{{ 'people.users.noZones' | rokuT }}</p>
        } @else {
          <ul class="panel" data-zones>
            @for (zone of zones(); track zone.id) {
              <li class="row">
                <span class="row-main">
                  @if (zone.path; as path) {
                    <a [routerLink]="path" class="row-title">{{ zone.name }}</a>
                  } @else {
                    <span class="row-title">{{ zone.name }}</span>
                  }
                </span>
                @if (zone.roleKey; as key) {
                  <span class="chip">{{ key | rokuT }}</span>
                }
                @if (zone.statusKey; as key) {
                  <span
                    [class.danger]="!zone.inside && key !== pendingKey"
                    [class.good]="zone.inside"
                    [class.waiting]="key === pendingKey"
                    class="chip"
                    >{{ key | rokuT }}</span
                  >
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styles: [PEOPLE_STYLES],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonZonesTab {
  private readonly _registry = inject(ResourceRegistry);

  /** The person, from the page. */
  private readonly _userId = inject(RECORD_CONTEXT).id;

  readonly pendingKey = 'people.zones.membership.PENDING';

  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly zones = signal<readonly PersonZone[]>([]);

  /** So that an older answer never lands on a newer one. */
  private _generation = 0;

  constructor() {
    this.load();
  }

  load(): void {
    void this._read(this._userId);
  }

  private async _read(userId: string): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    const descriptor = this._registry.byName('zones');

    this.state.set('loading');
    this.zones.set([]);
    if (userId === '' || descriptor === undefined) {
      return;
    }
    const gateway = this._registry.gatewayFor(descriptor);

    try {
      const page = await gateway.list({
        filters: { userId },
        limit: ZONE_LIMIT,
      });
      const rows = await Promise.all(
        page.items.map(async (row): Promise<PersonZone> => {
          const zone = row as ZoneRow;
          // What the person is there is on the zone's own read.
          const member = await gateway
            .read(zone.id)
            .then((detail) =>
              (detail as ZoneRow).members?.find(
                (entry) => entry.userId === userId
              )
            )
            .catch(() => undefined);

          return {
            id: zone.id,
            name: zone.name,
            path: this._registry.rowPath('zones', zone.id),
            roleKey:
              member === undefined ? null : `people.zones.role.${member.role}`,
            statusKey:
              member === undefined
                ? null
                : `people.zones.membership.${member.status}`,
            inside: member?.status === 'APPROVED',
          };
        })
      );

      if (generation === this._generation) {
        this.zones.set(rows);
        this.state.set('ready');
      }
    } catch {
      if (generation === this._generation) {
        this.state.set('error');
      }
    }
  }
}
