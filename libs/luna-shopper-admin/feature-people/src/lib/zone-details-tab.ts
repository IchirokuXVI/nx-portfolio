import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import { FactList, type Fact } from './fact-list';
import { instant } from './people-format';
import { PEOPLE_STYLES } from './people-styles';
import { ZoneContext } from './shopper-contexts';

/**
 * The Details tab of a zone (admin plan 0045, target 5): the facts, and the
 * configuration.
 *
 * It reads and does not write. "Edit zone" in the header opens the form, which
 * is where the name and the configuration change.
 */
@Component({
  selector: 'lib-zone-details-tab',
  imports: [FactList, RokuTranslatorPipe],
  template: `
    @if (zone.row(); as row) {
      <lib-fact-list [facts]="facts()" />

      <section aria-labelledby="zone-config-heading" class="config">
        <h3 id="zone-config-heading">{{ 'people.zones.config' | rokuT }}</h3>
        @if (config() === '') {
          <p class="muted">{{ 'people.zones.noConfig' | rokuT }}</p>
        } @else {
          <pre class="panel mono">{{ config() }}</pre>
        }
      </section>
    } @else if (zone.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }
  `,
  styles: [
    PEOPLE_STYLES,
    `
      .config {
        display: flex;
        flex-direction: column;
        gap: var(--admin-space-2);
      }

      pre {
        padding: var(--admin-space-4);
        overflow-x: auto;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneDetailsTab {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _registry = inject(ResourceRegistry);

  readonly zone = inject(ZoneContext);

  readonly facts = computed<readonly Fact[]>(() => {
    const zone = this.zone.row();
    if (zone === null) {
      return [];
    }
    const locale = this._translator.locale();

    return [
      { label: 'people.zones.name', text: zone.name },
      {
        label: 'people.zones.status.label',
        text: this._translator.t(`people.zones.status.${zone.status}`),
      },
      {
        label: 'people.zones.owner',
        text: this.zone.ownerName() ?? '',
        link:
          zone.ownerUserId === null
            ? null
            : this._registry.rowPath('users', zone.ownerUserId),
      },
      { label: 'people.zones.joinCode', text: zone.joinCode, mono: true },
      { label: 'people.zones.memberCount', text: String(zone.memberCount) },
      { label: 'people.zones.pendingCount', text: String(zone.pendingCount) },
      { label: 'people.zones.listCount', text: String(zone.listCount) },
      {
        label: 'people.zones.markedForDeletionAt',
        text: instant(zone.markedForDeletionAt, locale),
      },
      {
        label: 'people.zones.createdAt',
        text: instant(zone.createdAt, locale),
      },
      {
        label: 'people.zones.updatedAt',
        text: instant(zone.updatedAt, locale),
      },
      { label: 'people.zones.id', text: zone.id, mono: true },
    ];
  });

  /** The configuration as printed JSON, or empty for a zone that set none. */
  readonly config = computed(() => {
    const config = this.zone.row()?.config ?? {};
    return Object.keys(config).length === 0
      ? ''
      : JSON.stringify(config, null, 2);
  });
}
