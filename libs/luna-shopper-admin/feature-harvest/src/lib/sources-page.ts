import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { InfoContent, Wire } from '@portfolio/luna-shopper-admin/models';
import {
  CautionLine,
  ConfirmDialog,
  HarvestNotice,
  InfoButton,
  ReferencePicker,
} from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';

type Source = Wire.HarvestSupermarketSourceView;

/**
 * An adapter a source row may be written with.
 *
 * Narrower than the view's `EnumsAdapterKey`, which still lists `osm-places`
 * because rows written before backend plan 0153 hold it. OpenStreetMap is asked
 * for every postal code and has no row to switch it on, so the upsert refuses
 * the key and the document no longer offers it (admin plan 0034, section 4).
 */
type SourceAdapterKey = Wire.UpsertSupermarketSourceDto['adapterKey'];

/**
 * The adapters `UpsertSupermarketSourceDto` accepts, in the order the picker
 * offers them.
 *
 * It is a `Record` keyed on the wire union rather than an array of strings so
 * that a key the document declares and this screen does not is a compile error
 * here. The array form drifted twice: `lidl-api` (backend plan 0089) and
 * `carrefour-web` (backend plan 0090) both reached the contract, the gateway and
 * the generated types while this list still named four adapters, so two chains
 * shipped with a runner nobody could describe a source for.
 *
 * The values are the order, and nothing else reads them.
 */
const ADAPTER_ORDER: Record<SourceAdapterKey, number> = {
  'mercadona-api': 1,
  'deza-web': 2,
  'eljamon-web': 3,
  'dia-api': 4,
  'carrefour-web': 5,
  'lidl-api': 6,
  manual: 7,
};

const ADAPTERS: readonly SourceAdapterKey[] = (
  Object.keys(ADAPTER_ORDER) as SourceAdapterKey[]
).sort((a, b) => ADAPTER_ORDER[a] - ADAPTER_ORDER[b]);

/** Whether a row's adapter is one a row may still be written with. */
function writable(key: Wire.EnumsAdapterKey): key is SourceAdapterKey {
  return key in ADAPTER_ORDER;
}

/**
 * The settings column as the text an operator edits.
 *
 * Indented, because the box is where somebody reads a setting as well as where
 * they type one, and a single line of JSON is not something a person checks a
 * warehouse id against.
 */
function configTextOf(
  config: Record<string, unknown> | null | undefined
): string {
  return JSON.stringify(config ?? {}, null, 2);
}

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
 * on a phone. "Change" opens the form in the row, with the caution about
 * asking too fast. Each of the two switch columns has its own info button.
 */
@Component({
  selector: 'lib-sources-page',
  imports: [
    CautionLine,
    FormsModule,
    RokuTranslatorPipe,
    ConfirmDialog,
    HarvestNotice,
    InfoButton,
    ReferencePicker,
  ],
  template: `
    @if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      @if (creating()) {
        <div class="create">
          <div class="field">
            <span>{{ 'harvest.sources.field.chain' | rokuT }}</span>
            <lib-reference-picker
              (valueChange)="newChainId.set($event)"
              [controlId]="'source-chain'"
              [label]="'harvest.sources.field.chain' | rokuT"
              [lookup]="references"
              [resource]="'supermarkets'"
              [value]="newChainId()"
            />
          </div>

          @if (duplicate()) {
            <p class="hint">{{ 'harvest.sources.exists' | rokuT }}</p>
          }

          <div class="edit">
            <label>
              <span>{{ 'harvest.sources.field.adapter' | rokuT }}</span>
              <select [(ngModel)]="adapterKey" name="adapterKey">
                @for (option of adapters; track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            </label>
            <label>
              <span>{{ 'harvest.sources.field.workers' | rokuT }}</span>
              <input
                [(ngModel)]="workers"
                min="1"
                name="workers"
                type="number"
              />
            </label>
            <label>
              <span>{{ 'harvest.sources.field.rate' | rokuT }}</span>
              <input [(ngModel)]="rate" min="1" name="rate" type="number" />
            </label>
            <label class="wide">
              <span>{{ 'harvest.sources.field.config' | rokuT }}</span>
              <textarea
                [(ngModel)]="configText"
                name="config"
                rows="3"
                spellcheck="false"
              ></textarea>
              <small>{{ 'harvest.sources.config.hint' | rokuT }}</small>
            </label>

            @if (formErrorKey(); as key) {
              <p class="failure" role="alert">{{ key | rokuT }}</p>
            }

            <div class="controls">
              <button
                (click)="create()"
                [disabled]="
                  newChainId() === '' || duplicate() || busyId() !== null
                "
                class="primary"
                type="button"
              >
                {{ 'harvest.sources.create' | rokuT }}
              </button>
              <button (click)="creating.set(false)" type="button">
                {{ 'resource.action.cancel' | rokuT }}
              </button>
            </div>
          </div>
        </div>
      } @else {
        <div class="top">
          <button (click)="startCreate()" class="new" type="button">
            {{ 'harvest.sources.new' | rokuT }}
          </button>
        </div>
      }

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
              <li [class.open]="editing() === source.supermarketId">
                <div class="row">
                  <span class="cell chain">{{
                    names.nameOf(source.supermarketId)
                  }}</span>

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
                    @if (editing() !== source.supermarketId) {
                      <button (click)="edit(source)" type="button" data-change>
                        {{ 'harvest.sources.edit' | rokuT }}
                      </button>
                    }
                  </span>
                </div>

                @if (editing() === source.supermarketId) {
                  <!-- The form opens in the row. Beside the two settings it
                       warns about, and only while they can be changed (admin
                       plan 0041, section 3). -->
                  <div class="edit">
                    <label>
                      <span>{{ 'harvest.sources.field.adapter' | rokuT }}</span>
                      <select [(ngModel)]="adapterKey" name="adapterKey">
                        @for (option of adapters; track option) {
                          <option [value]="option">{{ option }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>{{ 'harvest.sources.field.workers' | rokuT }}</span>
                      <input
                        [(ngModel)]="workers"
                        min="1"
                        name="workers"
                        type="number"
                      />
                    </label>
                    <label>
                      <span>{{ 'harvest.sources.field.rate' | rokuT }}</span>
                      <input
                        [(ngModel)]="rate"
                        min="1"
                        name="rate"
                        type="number"
                      />
                    </label>
                    <label class="wide">
                      <span>{{ 'harvest.sources.field.config' | rokuT }}</span>
                      <textarea
                        [(ngModel)]="configText"
                        name="config"
                        rows="3"
                        spellcheck="false"
                      ></textarea>
                      <small>{{ 'harvest.sources.config.hint' | rokuT }}</small>
                    </label>

                    @if (formErrorKey(); as key) {
                      <p class="failure" role="alert">{{ key | rokuT }}</p>
                    }

                    <div class="controls">
                      <button
                        (click)="save(source)"
                        class="primary"
                        type="button"
                      >
                        {{ 'resource.action.save' | rokuT }}
                      </button>
                      <button (click)="editing.set(null)" type="button">
                        {{ 'resource.action.cancel' | rokuT }}
                      </button>
                      <button
                        (click)="askDelete(source)"
                        [disabled]="busyId() === source.supermarketId"
                        class="danger"
                        type="button"
                      >
                        {{ 'harvest.sources.remove.action' | rokuT }}
                      </button>
                    </div>

                    <lib-caution-line
                      [text]="'harvest.sources.caution' | rokuT"
                    />
                  </div>
                }
              </li>
            }
          </ul>
        </div>
      }

      <!-- Read only, and not a row: OpenStreetMap is asked by the postal code
           queue for every code, so there is nothing about it to switch or
           configure here (backend plan 0153). -->
      <p class="always">{{ 'harvest.sources.osmAlways' | rokuT }}</p>

      @if (pendingDelete(); as target) {
        <lib-confirm-dialog
          (confirm)="confirmDelete(target)"
          (dismiss)="pendingDelete.set(null)"
          [bodyArgs]="{ chain: names.nameOf(target.supermarketId) }"
          [busy]="busyId() === target.supermarketId"
          bodyKey="harvest.sources.remove.body"
          confirmKey="harvest.sources.remove.confirm"
          headingKey="harvest.sources.remove.heading"
        />
      }
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

    .create,
    .table {
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .create {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
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

    .sources li.open {
      background: var(--admin-accent-wash);
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

    .edit {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
      padding: var(--admin-space-3) var(--admin-space-4) var(--admin-space-4);
    }

    .create .edit {
      padding: 0;
    }

    .field,
    label {
      display: flex;
      flex: 1 1 9rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .field > span,
    label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .wide {
      flex: 3 1 18rem;
    }

    textarea {
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }

    .edit lib-caution-line,
    .edit .failure {
      flex-basis: 100%;
    }

    button {
      cursor: pointer;
    }

    .primary {
      border-color: var(--admin-accent);
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-on-wash);
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
  /** Answers the create panel's chain picker, by descriptor name. */
  readonly references = inject(ResourceReferences);
  /** Names the chain each row is about, so the list does not read as uuids. */
  readonly names = inject(ChainNames);

  readonly adapters = ADAPTERS;

  readonly sources = signal<readonly Source[]>([]);
  readonly loading = signal(true);
  readonly error = signal<GatewayError | null>(null);
  /** The chain a write is in flight for, so only its own control is disabled. */
  readonly busyId = signal<string | null>(null);
  readonly editing = signal<string | null>(null);

  /** Whether the create panel is open. Opening it closes any row edit. */
  readonly creating = signal(false);
  /** The chain the create panel points at, or empty until one is chosen. */
  readonly newChainId = signal('');
  /**
   * Whether the chosen chain already has a row. The backend route is an upsert,
   * so a create for such a chain would silently rewrite a configuration nobody
   * was looking at. The panel refuses it and points at the list instead.
   */
  readonly duplicate = computed(() =>
    this.sources().some((row) => row.supermarketId === this.newChainId())
  );

  readonly adapterKey = signal<SourceAdapterKey>('manual');
  readonly workers = signal(1);
  readonly rate = signal(1);
  /**
   * The adapter's own settings, as the JSON text an operator edits.
   *
   * It is free form on purpose, because the column is: `config` is whatever the
   * adapter that reads it wants, and a form with a field per adapter would have
   * to be extended in this screen every time a runner learns a setting. What
   * the screen owes instead is that a value which is not JSON never reaches the
   * backend, which is what {@link parsedConfig} is for.
   */
  readonly configText = signal('{}');
  /**
   * What is wrong with the form itself, as opposed to what the server said.
   *
   * Kept apart from {@link error} because the two are cleared at different
   * times and mean different things: this one is answered by typing, and a
   * gateway failure is not.
   */
  readonly formErrorKey = signal<string | null>(null);
  /** The row a delete is being confirmed for, or null while nothing is asked. */
  readonly pendingDelete = signal<Source | null>(null);

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

  edit(source: Source): void {
    this.creating.set(false);
    this.editing.set(source.supermarketId);
    // A row that still names `osm-places` opens on `manual`, which is what it
    // can be saved as: the key it holds is refused on the way back in.
    this.adapterKey.set(
      writable(source.adapterKey) ? source.adapterKey : 'manual'
    );
    this.workers.set(source.workers);
    this.rate.set(source.maxRequestsPerSecond);
    this.configText.set(configTextOf(source.config));
    this.formErrorKey.set(null);
  }

  /** Open the create panel, with the backend's own defaults in the fields. */
  startCreate(): void {
    this.editing.set(null);
    this.creating.set(true);
    this.newChainId.set('');
    this.adapterKey.set('manual');
    this.workers.set(4);
    this.rate.set(4);
    this.configText.set('{}');
    this.formErrorKey.set(null);
  }

  /**
   * Describe a chain that has no row yet.
   *
   * The row is created **disabled**, by the backend and on purpose: describing
   * a chain and starting to fetch it are two decisions, and the second one is
   * the toggle on the row this panel adds to the list. `config` is not sent, so
   * the backend's empty default stands; the form does not edit it, for the
   * reason `save` gives.
   */
  async create(): Promise<void> {
    const chainId = this.newChainId();
    if (chainId === '' || this.duplicate()) {
      return;
    }

    const config = this.parsedConfig();
    if (config === null) {
      return;
    }

    this.busyId.set(chainId);
    this.error.set(null);

    try {
      const created = await this._service.upsertSource(chainId, {
        adapterKey: this.adapterKey(),
        workers: this.workers(),
        maxRequestsPerSecond: this.rate(),
        config,
      });
      // First, which is where the server's newest first ordering would put it
      // on the next load.
      this.sources.update((rows) => [created, ...rows]);
      void this.names.resolve([created.supermarketId]);
      this.creating.set(false);
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
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
    if (!writable(adapterKey)) {
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

  async save(source: Source): Promise<void> {
    const config = this.parsedConfig();
    if (config === null) {
      return;
    }

    this.busyId.set(source.supermarketId);
    this.error.set(null);

    try {
      const updated = await this._service.upsertSource(source.supermarketId, {
        adapterKey: this.adapterKey(),
        workers: this.workers(),
        maxRequestsPerSecond: this.rate(),
        config,
      });
      this._replace(updated);
      this.editing.set(null);
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  /** Ask before a row goes, because nothing here has an undo. */
  askDelete(source: Source): void {
    this.error.set(null);
    this.pendingDelete.set(source);
  }

  /**
   * Undescribe a chain.
   *
   * The row is keyed on the chain, so a source created against the wrong chain
   * cannot be moved onto the right one: the upsert would write a second row
   * beside it. Deleting and describing it again is the way back, and before
   * this screen had it a wrong pick in the create panel was permanent.
   *
   * The backend refuses while a run of that chain is in flight, which arrives
   * as an ordinary conflict and leaves the row where it is.
   */
  async confirmDelete(source: Source): Promise<void> {
    this.busyId.set(source.supermarketId);
    this.error.set(null);

    try {
      await this._service.deleteSource(source.supermarketId);
      this.sources.update((rows) => rows.filter((row) => row.id !== source.id));
      if (this.editing() === source.supermarketId) {
        this.editing.set(null);
      }
      this.pendingDelete.set(null);
    } catch (error) {
      // The dialog stays open with the failure beneath it, because the operator
      // asked for this row and a dialog that closes on a refusal reads as a
      // delete that worked.
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  instant(value: string | null): string {
    return formatInstant(value);
  }

  /** Whether the row can go back through the upsert as it stands. */
  writable(source: Source): boolean {
    return writable(source.adapterKey);
  }

  /**
   * The settings box as an object, or null when it is not JSON.
   *
   * Null is refused rather than sent: `config` reaches the harvester as it is
   * written and is read at fetch time, so a broken value would be found by a
   * run rather than by the person who typed it. A blank box is `{}`, which is
   * the column's own default and is what clearing the settings means.
   */
  private parsedConfig(): Record<string, unknown> | null {
    const text = this.configText().trim();
    if (text === '') {
      this.formErrorKey.set(null);
      return {};
    }

    try {
      const value: unknown = JSON.parse(text);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        this.formErrorKey.set('harvest.sources.config.invalid');
        return null;
      }
      this.formErrorKey.set(null);
      return value as Record<string, unknown>;
    } catch {
      this.formErrorKey.set('harvest.sources.config.invalid');
      return null;
    }
  }

  private _replace(source: Source): void {
    this.sources.update((rows) =>
      rows.map((row) => (row.id === source.id ? source : row))
    );
  }
}
