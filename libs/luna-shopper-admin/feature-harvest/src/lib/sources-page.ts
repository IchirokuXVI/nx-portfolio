import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  RECORD_EDIT_PARAM,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { InfoContent, Wire } from '@portfolio/luna-shopper-admin/models';
import { HarvestNotice, InfoButton } from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';
import { isWritableAdapter } from './sources-gateway';

type Source = Wire.HarvestSupermarketSourceView;

/**
 * Per chain fetching configuration (plan 0006, sections 3 and 8).
 *
 * This is where the **one** switch of section 3 that the app is allowed to
 * change lives, and since backend plan `0083` it is also the only per chain
 * switch there is anywhere: the variable that used to gate one storefront by
 * name is gone, and this row answers that question for every chain. `enabled` is
 * application state, unlike `HARVEST_ENABLED`, which is deployment configuration
 * and is shown on the runs screen without a control beside it.
 *
 * Putting it here rather than in the switch panel is the point. Deployment
 * switches an operator cannot touch and one they can, all in a row, would read
 * as the same kind of thing, and the whole reason the panel exists is that they
 * are not.
 *
 * `enabled` gets its own route because describing a chain and starting to fetch
 * it are two decisions. The toggle calls that route directly, so turning a chain
 * on does not resend a configuration nobody was editing.
 *
 * `autoImportPlaces` is the second switch and the third decision (backend plan
 * 0107, section 3.1): whether the shops this chain names may enter the catalog
 * with nobody looking first. It is the one switch in the harvester that writes
 * to the catalog without a review, which is why it carries a sentence saying so
 * rather than a bare label. It has no route of its own and goes through the
 * upsert, so the row's own values are sent back beside it rather than the edit
 * form's.
 *
 * **A part of the Setup tab** (admin plan 0044, target 6), so the page above
 * draws the header. One row per chain on a wide screen and one card per chain
 * on a phone. Each of the two switch columns has its own info button.
 *
 * **A row opens the record page of its source** (admin plan 0059), which is
 * where a source is added, changed and deleted. The forms this page drew are
 * gone. The two switches are still here, and each still writes at once.
 */
@Component({
  selector: 'lib-sources-page',
  imports: [HarvestNotice, InfoButton, RokuTranslatorPipe, RouterLink],
  template: `
    @if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      <div class="top">
        <a class="button new" routerLink="new" data-add>
          {{ 'harvest.sources.add' | rokuT }}
        </a>
      </div>

      @if (sources().length === 0) {
        <p class="state">{{ 'harvest.sources.empty' | rokuT }}</p>
      } @else {
        <!-- One row per chain on a wide screen and one card per chain on a
             phone (admin plan 0044, target 6). The same cells either way: a
             card writes each label beside its value, and a row reads them
             off the head above. -->
        <div class="table">
          <div aria-hidden="true" class="row head">
            <span>{{ 'harvest.sources.field.chain' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.adapter' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.enabled' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.trusted' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.workers' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.rate' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.lastSuccessAt' | rokuT }}</span>
            <span>{{ 'harvest.sources.field.failures' | rokuT }}</span>
            <span></span>
          </div>

          <!-- Each switch column has its own info button. Outside the head,
               which is hidden from a screen reader as a set of labels the
               cells repeat, and placed over it. -->
          <div class="head-info">
            <span class="pair">
              <span class="label">{{
                'harvest.sources.field.enabled' | rokuT
              }}</span>
              <lib-info-button [info]="enabledInfo" align="start" />
            </span>
            <span class="pair">
              <span class="label">{{
                'harvest.sources.field.trusted' | rokuT
              }}</span>
              <lib-info-button [info]="trustedInfo" align="start" />
            </span>
          </div>

          <ul class="sources">
            @for (source of sources(); track source.id) {
              <li>
                <div class="row">
                  <a
                    [routerLink]="[source.supermarketId]"
                    class="cell chain"
                    data-open
                    >{{ names.nameOf(source.supermarketId) }}</a
                  >

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.adapter' | rokuT
                    }}</span>
                    <span class="adapter">{{ source.adapterKey }}</span>
                  </span>

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.enabled' | rokuT
                    }}</span>
                    <button
                      (click)="toggle(source)"
                      [attr.aria-checked]="source.enabled"
                      [attr.aria-label]="
                        'harvest.sources.enabled.label'
                          | rokuT: { chain: names.nameOf(source.supermarketId) }
                      "
                      [class.on]="source.enabled"
                      [disabled]="busyId() === source.supermarketId"
                      class="toggle"
                      role="switch"
                      type="button"
                      data-switch="enabled"
                    >
                      <i></i>
                    </button>
                  </span>

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.trusted' | rokuT
                    }}</span>
                    <button
                      (click)="toggleTrust(source)"
                      [attr.aria-checked]="source.autoImportPlaces"
                      [attr.aria-label]="
                        'harvest.sources.trusted.label'
                          | rokuT: { chain: names.nameOf(source.supermarketId) }
                      "
                      [class.on]="source.autoImportPlaces"
                      [disabled]="
                        busyId() === source.supermarketId || !writable(source)
                      "
                      class="toggle"
                      role="switch"
                      type="button"
                      data-switch="trusted"
                    >
                      <i></i>
                    </button>
                  </span>

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.workers' | rokuT
                    }}</span>
                    <span class="num">{{ source.workers }}</span>
                  </span>

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.rate' | rokuT
                    }}</span>
                    <span class="num">{{ source.maxRequestsPerSecond }}</span>
                  </span>

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.lastSuccessAt' | rokuT
                    }}</span>
                    <span class="muted">{{
                      instant(source.lastSuccessAt) ||
                        ('harvest.sources.never' | rokuT)
                    }}</span>
                  </span>

                  <span class="cell">
                    <span class="label">{{
                      'harvest.sources.field.failures' | rokuT
                    }}</span>
                    <span
                      [class.failing]="source.consecutiveFailures > 0"
                      class="num failures"
                      >{{ source.consecutiveFailures }}</span
                    >
                  </span>

                  <span class="cell act">
                    <a
                      [queryParams]="editQuery"
                      [routerLink]="[source.supermarketId]"
                      class="button"
                      data-change
                    >
                      {{ 'harvest.sources.edit' | rokuT }}
                    </a>
                  </span>
                </div>
              </li>
            }
          </ul>
        </div>
      }

      <!-- Read only, and not a row: OpenStreetMap is asked by the postal code
           queue for every code, so there is nothing about it to switch or
           configure here (backend plan 0153). -->
      <p class="always">{{ 'harvest.sources.osmAlways' | rokuT }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius-control);
      background: var(--admin-danger-wash);
    }

    .always,
    .hint,
    .muted,
    small {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .top {
      display: flex;
      justify-content: flex-end;
    }

    /* A link drawn as a button: it goes to the record page of a source. */
    .button {
      display: inline-flex;
      align-items: center;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font-size: 0.875rem;
      text-decoration: none;
      color: inherit;
    }

    a.chain {
      color: inherit;
    }

    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .table {
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .table {
      position: relative;
      overflow: hidden;
    }

    .sources {
      list-style: none;
    }

    .sources li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    /* Nine columns: the chain, how it is fetched, the two switches, the two
       numbers, the last good run, the failures, and the action. */
    .row {
      display: grid;
      grid-template-columns:
        minmax(7rem, 1.2fr) minmax(7rem, 1fr) 9.5rem 7.5rem 4.5rem 6.5rem
        minmax(6rem, 1fr) 6rem 5.5rem;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-2) var(--admin-space-4);
    }

    .head {
      min-block-size: 2.75rem;
      border-block-end: 1px solid var(--admin-border);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    /* The two info buttons sit in the head, at the end of the third and the
       fourth column. */
    .head-info {
      position: absolute;
      inset-block-start: 0;
      inset-inline: 0;
      display: grid;
      grid-template-columns:
        minmax(7rem, 1.2fr) minmax(7rem, 1fr) 9.5rem 7.5rem 4.5rem 6.5rem
        minmax(6rem, 1fr) 6rem 5.5rem;
      gap: var(--admin-space-3);
      align-items: center;
      block-size: 2.75rem;
      padding: 0 var(--admin-space-4);
      pointer-events: none;
    }

    .head-info .pair {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      justify-self: end;
      pointer-events: auto;
    }

    .head-info .label {
      display: none;
    }

    .head-info .pair:first-child {
      grid-column: 3;
    }

    .head-info .pair:last-child {
      grid-column: 4;
    }

    .cell {
      display: flex;
      align-items: center;
      min-inline-size: 0;
    }

    .cell .label {
      display: none;
    }

    .chain {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .adapter {
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
    }

    .num {
      font-variant-numeric: tabular-nums;
    }

    /* Failures in a row wait for a person: the chain may be blocking us. */
    .failures.failing {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-waiting-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-waiting-on-wash);
    }

    .act {
      justify-content: flex-end;
    }

    /* A switch: a track and a knob, on when the knob is at the far end. Its
       state is also its aria-checked, so color and place are not the only
       signs. */
    .toggle {
      position: relative;
      flex: none;
      inline-size: 2.5rem;
      min-inline-size: 0;
      block-size: 1.5rem;
      min-block-size: 0;
      padding: 0;
      border: 1px solid var(--admin-border-strong);
      border-radius: 0.75rem;
      background: var(--admin-neutral-wash);
    }

    .toggle i {
      position: absolute;
      inset-block-start: 0.125rem;
      inset-inline-start: 0.125rem;
      inline-size: 1.125rem;
      block-size: 1.125rem;
      border-radius: 50%;
      background: var(--admin-surface-raised);
      box-shadow: 0 0 0 1px var(--admin-border-strong);
    }

    .toggle.on {
      border-color: var(--admin-accent);
      background: var(--admin-accent);
    }

    .toggle.on i {
      inset-inline-start: 1.125rem;
      box-shadow: none;
    }

    button {
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    /* Below 72 rem nine columns do not fit: one card per chain, each value
       under its label. */
    @media (max-width: 71.99rem) {
      .head {
        display: none;
      }

      /* What the two switches mean, said once above the cards. */
      .head-info {
        position: static;
        display: flex;
        flex-wrap: wrap;
        gap: var(--admin-space-4);
        padding: var(--admin-space-2) var(--admin-space-4);
        border-block-end: 1px solid var(--admin-border);
      }

      .head-info .label {
        display: inline;
        font-size: 0.8125rem;
        color: var(--admin-ink-muted);
      }

      .row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--admin-space-3);
        padding: var(--admin-space-3) var(--admin-space-4);
      }

      .cell {
        flex-direction: column;
        gap: var(--admin-space-1);
        align-items: flex-start;
      }

      .cell .label {
        display: block;
        font-size: 0.75rem;
        color: var(--admin-ink-muted);
      }

      .chain,
      .act {
        grid-column: 1 / -1;
      }

      .act {
        align-items: stretch;
      }

      .toggle {
        /* The target is 44 px high on a phone. The track stays its size. */
        margin-block: 0.625rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcesPage {
  private readonly _service = inject(HARVEST_SERVICE);

  /** What "May be fetched" allows (admin plan 0044, target 6). */
  readonly enabledInfo: InfoContent = {
    title: 'harvest.sources.enabled.info.title',
    points: [
      'harvest.sources.enabled.info.allows',
      'harvest.sources.enabled.info.off',
    ],
  };

  /**
   * What "Trusted" means. The one switch in the harvester that writes to the
   * catalog without a review, which the last point says.
   */
  readonly trustedInfo: InfoContent = {
    title: 'harvest.sources.trusted.info.title',
    points: [
      'harvest.sources.trusted.info.means',
      'harvest.sources.trusted.info.waits',
      'harvest.sources.trusted.info.only',
    ],
  };

  readonly shell = inject(HarvestShell);
  /** Names the chain each row is about, so the list does not read as uuids. */
  readonly names = inject(ChainNames);

  /** What opens the record of a source with its form: "Change". */
  readonly editQuery = { [RECORD_EDIT_PARAM]: '1' };

  readonly sources = signal<readonly Source[]>([]);
  readonly loading = signal(true);
  readonly error = signal<GatewayError | null>(null);
  /** The chain a write is in flight for, so only its own control is disabled. */
  readonly busyId = signal<string | null>(null);

  readonly failed = computed(
    () => this.error() !== null && this.sources().length === 0
  );

  readonly errorKey = computed(() =>
    this.failed() ? null : gatewayErrorKey(this.error())
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const page = await this._service.listSources({ limit: 50 });
      this.sources.set(page.items);
      // Fired and not awaited: a name arriving late redraws one span, and a
      // lookup failure costs a name rather than the screen.
      void this.names.resolve(page.items.map((row) => row.supermarketId));
      this.shell.observeReachable();
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Turn one chain on or off.
   *
   * The reply replaces the row rather than the screen reading the list again, so
   * an operator working down a list of chains does not lose their place on every
   * toggle. A failure leaves the row as it was, because a control that flipped
   * and then silently flipped back would be worse than one that did not move.
   */
  async toggle(source: Source): Promise<void> {
    this.busyId.set(source.supermarketId);
    this.error.set(null);

    try {
      const updated = await this._service.setSourceEnabled(
        source.supermarketId,
        !source.enabled
      );
      this._replace(updated);
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  /**
   * Trust this chain's own shop list, or stop.
   *
   * There is no route for this one, so it goes through the upsert with the
   * **row's own** values beside it rather than the edit form's signals: the
   * form may be closed, or open on another row, and a trust toggle must not
   * rewrite a configuration nobody was editing.
   */
  async toggleTrust(source: Source): Promise<void> {
    // The upsert resends the row's adapter, and an `osm-places` row's is one
    // the server refuses. Its control is disabled; this is the same rule for a
    // caller that is not the template.
    const adapterKey = source.adapterKey;
    if (!isWritableAdapter(adapterKey)) {
      return;
    }

    this.busyId.set(source.supermarketId);
    this.error.set(null);

    try {
      const updated = await this._service.upsertSource(source.supermarketId, {
        adapterKey,
        workers: source.workers,
        maxRequestsPerSecond: source.maxRequestsPerSecond,
        config: source.config,
        autoImportPlaces: !source.autoImportPlaces,
      });
      this._replace(updated);
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  instant(value: string | null): string {
    return formatInstant(value);
  }

  /**
   * Whether the row can go back through the upsert as it stands. A row that
   * still names `osm-places` cannot: the server refuses the key.
   */
  writable(source: Source): boolean {
    return isWritableAdapter(source.adapterKey);
  }

  private _replace(source: Source): void {
    this.sources.update((rows) =>
      rows.map((row) => (row.id === source.id ? source : row))
    );
  }
}
