import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  harvestSetupPath,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import { HarvestHeader } from './harvest-header';

/** What the info button of Setup says. */
export const SETUP_INFO: InfoContent = {
  title: 'harvest.setup.info.title',
  points: [
    'harvest.setup.info.sources',
    'harvest.setup.info.brands',
    'harvest.setup.info.postalCodes',
  ],
};

/** One entry of the switch between the parts of Setup. */
interface PartEntry {
  readonly key: 'sources' | 'brands' | 'postal-codes';
  readonly labelKey: string;
  readonly path: readonly string[];
}

/**
 * Setup: what is set up once and then left alone (admin plan 0044, target 6).
 *
 * Chain sources, registered brands and postal codes were three screens in a
 * row of ten, beside the queues a person works every day. They are reference
 * data: how each chain is fetched, the names products are filed under, and
 * where the harvester looks for shops. So they share the last tab, and a
 * switch of three entries picks the part.
 *
 * Each part is a child route. The brands and the postal codes are resources,
 * so their lists are the generic list drawn as a tab, and their addresses come
 * from the registry. A part the app did not mount has no entry.
 */
@Component({
  selector: 'lib-harvest-setup-page',
  imports: [
    HarvestHeader,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    RokuTranslatorPipe,
  ],
  template: `
    <lib-harvest-header [info]="info" />

    <nav [attr.aria-label]="'harvest.setup.parts' | rokuT" class="parts">
      @for (entry of entries; track entry.key) {
        <a
          [attr.data-part]="entry.key"
          [routerLink]="entry.path"
          ariaCurrentWhenActive="page"
          routerLinkActive="on"
        >
          {{ entry.labelKey | rokuT }}
          @if (entry.key === 'sources' && sources(); as count) {
            <span class="count">{{ count }}</span>
          }
        </a>
      }
    </nav>

    <router-outlet />
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    /* A row that does not fit scrolls sideways and never wraps. */
    .parts {
      display: flex;
      overflow-x: auto;
      max-inline-size: 100%;
      scrollbar-width: none;
    }

    .parts::-webkit-scrollbar {
      display: none;
    }

    .parts a {
      display: flex;
      flex: none;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      background: var(--admin-surface-raised);
      font-size: 0.875rem;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink-muted);
    }

    .parts a + a {
      margin-inline-start: -1px;
    }

    .parts a:first-child {
      border-start-start-radius: var(--admin-radius-control);
      border-end-start-radius: var(--admin-radius-control);
    }

    .parts a:last-child {
      border-start-end-radius: var(--admin-radius-control);
      border-end-end-radius: var(--admin-radius-control);
    }

    .parts a.on {
      z-index: 1;
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .parts a:focus-visible {
      z-index: 2;
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    /* A plain count, in grey: how many there are, and nothing waits. */
    .count {
      padding: 0.0625rem 0.375rem;
      border-radius: 0.5625rem;
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--admin-neutral-on-wash);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HarvestSetupPage {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _dashboard = inject(DashboardStore);

  readonly info = SETUP_INFO;

  readonly entries: readonly PartEntry[] = [
    {
      key: 'sources' as const,
      labelKey: 'harvest.sources.heading',
      path: harvestSetupPath(),
    },
    ...this._resource('brands'),
    ...this._resource('postal-codes'),
  ];

  /** How many chains have a source row, which the dashboard read counts. */
  readonly sources = computed(
    () => this._dashboard.document()?.harvest?.sources.total ?? null
  );

  /**
   * A part that is a resource, where the app mounted it. It is called what
   * its descriptor calls it, and it is where the registry says it is.
   */
  private _resource(key: 'brands' | 'postal-codes'): readonly PartEntry[] {
    const descriptor = this._registry.byName(key);
    const path = this._registry.pathOf(key);

    return descriptor === undefined || path === null
      ? []
      : [{ key, labelKey: descriptor.labels.many, path }];
  }
}
