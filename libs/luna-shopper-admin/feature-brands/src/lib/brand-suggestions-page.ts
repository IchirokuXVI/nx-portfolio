import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  type OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  ChainNames,
  formatInstant,
  formatSince,
  HARVEST_SEGMENT,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ReferencePicker, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { brandKey } from '@portfolio/luna-shopper/contracts/brand-key';
import { capitalizeBrand } from './brand-capitalization';
import { BRAND_BATCH_MAX } from './brand-sources';
import {
  BrandsGateway,
  type BrandBatchResult,
  type BrandSuggestion,
} from './brands-gateway';

/** A row ticked for a batch, and the label the person has settled on so far. */
interface PickedBrand {
  /** The suggestion's own key, which is what the batch has to register. */
  readonly key: string;
  /** How the chains print it, for the review to show beside the label. */
  readonly spelling: string;
  readonly label: string;
}

/** Why a label in the review cannot be sent, or `null` when it can. */
type ReviewProblem = 'noKey' | 'keyDiffers' | null;

/** One line of the review, with what its label would make. */
interface ReviewLine extends PickedBrand {
  readonly liveKey: string;
  readonly problem: ReviewProblem;
}

/** One line of a batch's answer, beside the row it was about. */
interface BatchLine {
  readonly key: string;
  readonly result: BrandBatchResult;
}

/**
 * The `details` key a `brand_key_taken` names the holding brand under.
 *
 * Repeated here rather than imported from `@portfolio/luna-shopper/platform`,
 * for the reason `ADMIN_APP_VERSION` is: that library's barrel exports the Nest
 * bootstrap and the platform module, so reaching into it for one string would
 * pull a backend framework into a browser bundle. The backend's own constant is
 * `BRAND_KEY_HOLDER_DETAIL` in `domain-exception.ts`, and the two have to agree.
 */
const BRAND_KEY_HOLDER_DETAIL = 'brandId';

/** How long typing settles before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * The brands the queue is asking for (admin plan 0027, section 3).
 *
 * **Hand written rather than a descriptor**, and the row is why: a
 * `ResourceCell` holds one text, and this row holds a spelling over its key, a
 * date over its age, and one chip per chain that carries it. A suggestion is
 * also not a resource. It has no id and nothing holds it: it is a key some
 * queued products carry that no registered brand claims, so there is no row to
 * open, edit or delete and the only act on it is to register one.
 *
 * **Everything the operator decides on is in the row.** There is no detail
 * screen, and every chain is shown rather than the first two and a "+2": a chain
 * hidden behind a count is a fact moved out of the row somebody is deciding on.
 *
 * **Registering is an inline panel, not a screen.** The decision is which
 * spelling becomes the label, and that decision is made while looking at the
 * spellings the chains used, which are on the row above it.
 *
 * **Selecting several keeps every label a decision** (admin plan 0035, section
 * 1). A person ticks each row, reads and edits each label in a review step, and
 * only then registers them in one request. Nothing is sent from a tick. The
 * batch registers names as they are and links nothing, so a label that makes a
 * different key than its row is held back in the review with a sentence saying
 * so: linking is the single panel's job, because it is decided while looking at
 * the one row.
 */
@Component({
  selector: 'lib-brand-suggestions-page',
  imports: [NgTemplateOutlet, RokuTranslatorPipe, ReferencePicker, RouterLink],
  template: `
    <header>
      <h1>{{ 'brands.suggested.heading' | rokuT }}</h1>
      <p class="lead">{{ 'brands.suggested.lead' | rokuT }}</p>
    </header>

    <label class="search">
      <span>{{ 'brands.suggested.search' | rokuT }}</span>
      <input
        (input)="onSearch($event)"
        [value]="query()"
        autocapitalize="none"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        type="search"
        data-search
      />
    </label>

    <!-- Selecting several (admin plan 0035, section 1). A tick only marks a
         row: the review below is the one place a batch is sent from. -->
    <div class="bulk-bar" role="group">
      @if (selecting()) {
        <p aria-live="polite" class="bulk-count">
          {{
            'brands.suggested.bulk.selected' | rokuT: { count: pickedCount() }
          }}
          @if (pickedCount() >= batchMax) {
            <span class="muted">{{
              'brands.suggested.bulk.full' | rokuT: { max: batchMax }
            }}</span>
          }
        </p>
        <button
          (click)="review()"
          [disabled]="pickedCount() === 0 || reviewing()"
          class="primary"
          type="button"
          data-review
        >
          {{ 'brands.suggested.bulk.review' | rokuT: { count: pickedCount() } }}
        </button>
        <button (click)="stopSelecting()" type="button" data-stop-selecting>
          {{ 'brands.suggested.bulk.stop' | rokuT }}
        </button>
      } @else {
        <button (click)="startSelecting()" type="button" data-select-mode>
          {{ 'brands.suggested.bulk.start' | rokuT }}
        </button>
      }
    </div>

    @if (batch(); as lines) {
      <section
        [attr.aria-label]="'brands.suggested.bulk.resultHeading' | rokuT"
        class="batch-result"
        role="status"
        data-batch-result
      >
        <h2>{{ 'brands.suggested.bulk.resultHeading' | rokuT }}</h2>
        <ul>
          @for (line of lines; track line.key) {
            <li [attr.data-outcome]="line.result.outcome">
              <strong>{{ line.result.label }}</strong>
              @switch (line.result.outcome) {
                @case ('CREATED') {
                  <span>{{
                    (line.result.linkedItems === null
                      ? 'brands.suggested.bulk.createdPlain'
                      : 'brands.suggested.bulk.created'
                    ) | rokuT: { count: line.result.linkedItems }
                  }}</span>
                }
                @case ('EXISTS') {
                  <span>{{ 'brands.suggested.bulk.exists' | rokuT }}</span>
                  @if (brandLink(line.result.brandId); as link) {
                    <a [routerLink]="link">{{
                      'brands.suggested.bulk.openExisting' | rokuT
                    }}</a>
                  }
                }
                @default {
                  <span class="refused">{{
                    'brands.suggested.bulk.refused' | rokuT
                  }}</span>
                  <span>{{ reasonKey(line.result.reasonCode) | rokuT }}</span>
                  @if (line.result.reasonDetail; as detail) {
                    <span class="detail">{{ detail }}</span>
                  }
                }
              }
            </li>
          }
        </ul>
        @if (pickedCount() > 0) {
          <p>{{ 'brands.suggested.bulk.refusedKept' | rokuT }}</p>
        }
      </section>
    }

    @if (reviewing()) {
      <section
        (keydown.escape)="backToList()"
        [attr.aria-label]="'brands.suggested.bulk.reviewHeading' | rokuT"
        class="review"
        role="group"
        tabindex="-1"
        data-review-panel
      >
        <h2>{{ 'brands.suggested.bulk.reviewHeading' | rokuT }}</h2>
        <p class="muted">{{ 'brands.suggested.bulk.reviewLead' | rokuT }}</p>

        @if (reviewLines().length === 0) {
          <p class="state">{{ 'brands.suggested.bulk.reviewEmpty' | rokuT }}</p>
        } @else {
          <ul class="review-lines">
            @for (line of reviewLines(); track line.key) {
              <li [attr.data-review-line]="line.key">
                <div class="review-head">
                  <span class="stack">
                    <span class="spelling">{{ line.spelling }}</span>
                    <span class="key">{{ line.key }}</span>
                  </span>
                  <button
                    (click)="unpick(line.key)"
                    [attr.aria-label]="
                      'brands.suggested.bulk.removeAria'
                        | rokuT: { name: line.spelling }
                    "
                    [disabled]="sendingBatch()"
                    type="button"
                    data-unpick
                  >
                    {{ 'brands.suggested.bulk.remove' | rokuT }}
                  </button>
                </div>
                <label>
                  <span>{{ 'brands.suggested.bulk.label' | rokuT }}</span>
                  <input
                    (input)="relabel(line.key, $event)"
                    [disabled]="sendingBatch()"
                    [value]="line.label"
                    type="text"
                    data-batch-label
                  />
                </label>
                @if (line.problem === 'noKey') {
                  <p class="warn-line">
                    {{ 'brands.suggested.bulk.noKey' | rokuT }}
                  </p>
                } @else if (line.problem === 'keyDiffers') {
                  <p class="warn-line">
                    {{
                      'brands.suggested.bulk.keyDiffers'
                        | rokuT: { key: line.liveKey, original: line.key }
                    }}
                  </p>
                } @else {
                  <p class="key">
                    {{
                      'brands.suggested.register.makesKey'
                        | rokuT: { key: line.liveKey }
                    }}
                  </p>
                }
              </li>
            }
          </ul>
        }

        @if (batchErrorKey(); as key) {
          <p class="failure" role="alert">{{ key | rokuT }}</p>
        }

        <div class="controls">
          <button
            (click)="sendBatch()"
            [disabled]="!canSend()"
            class="primary"
            type="button"
            data-send
          >
            {{
              (sendingBatch()
                ? 'resource.action.working'
                : 'brands.suggested.bulk.send'
              ) | rokuT: { count: reviewLines().length }
            }}
          </button>
          <button
            (click)="backToList()"
            [disabled]="sendingBatch()"
            type="button"
            data-back
          >
            {{ 'brands.suggested.bulk.back' | rokuT }}
          </button>
        </div>
      </section>
    }

    @if (done(); as said) {
      <p class="done" role="status">
        @if (said.spelling !== null) {
          {{
            'brands.suggested.register.doneLinked'
              | rokuT
                : {
                    spelling: said.spelling,
                    label: said.label,
                    count: said.linked,
                  }
          }}
        } @else {
          {{
            (said.linked === 0
              ? 'brands.suggested.register.doneNone'
              : 'brands.suggested.register.done'
            ) | rokuT: { label: said.label, count: said.linked }
          }}
        }
        <!-- The chain applies to a brand this register created, and the typed
             name named one that was already there, so what was picked was
             ignored. Said out loud, because the picker was on screen. -->
        @if (said.chainKept) {
          <span class="kept">{{
            'brands.suggested.register.chainKept' | rokuT: { label: said.label }
          }}</span>
        }
      </p>
    }

    @if (reviewing()) {
      <!-- The list waits while the review is open: the review is the decision,
           and a list still taking ticks beside it would make the two disagree. -->
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (failed()) {
      <p class="state error" role="alert">
        {{ errorKey() | rokuT }}
        <button (click)="reload()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </p>
    } @else if (rows().length === 0) {
      <p class="state">
        {{
          (query() === '' ? 'brands.suggested.empty' : 'resource.list.noMatch')
            | rokuT
        }}
      </p>
    } @else if (compact()) {
      <!-- On a phone the row is a card: the brand, then the figures, then the
           chips, then the action. A four column table at that width is
           unreadable however it scrolls. -->
      <ul class="cards">
        @for (row of rows(); track row.key) {
          <li>
            <article [class.picked]="isPicked(row.key)">
              @if (selecting()) {
                <label class="pick">
                  <input
                    (change)="toggle(row)"
                    [checked]="isPicked(row.key)"
                    [disabled]="!isPicked(row.key) && pickedCount() >= batchMax"
                    type="checkbox"
                    data-pick
                  />
                  <span>{{
                    'brands.suggested.bulk.selectRow'
                      | rokuT: { name: row.spelling }
                  }}</span>
                </label>
              }
              <h2>
                <span class="spelling">{{ row.spelling }}</span>
                <span class="key">{{ row.key }}</span>
              </h2>

              <dl>
                <div>
                  <dt>{{ 'brands.suggested.products' | rokuT }}</dt>
                  <dd class="figure">{{ count(row.productCount) }}</dd>
                </div>
                <div>
                  <dt>{{ 'brands.suggested.firstSeen' | rokuT }}</dt>
                  <dd>
                    {{ instant(row.firstSeenAt) }}
                    <span class="muted">{{ since(row.firstSeenAt) }}</span>
                  </dd>
                </div>
              </dl>

              <ul class="chips">
                @for (chain of row.chains; track chain.supermarketId) {
                  <li>
                    <a
                      [queryParams]="{
                        supermarketId: chain.supermarketId,
                        brandKey: row.key,
                      }"
                      [routerLink]="entriesLink"
                      class="chip"
                    >
                      <span aria-hidden="true">
                        {{
                          'brands.suggested.chain'
                            | rokuT
                              : {
                                  name: names.nameOf(chain.supermarketId),
                                  count: count(chain.productCount),
                                }
                        }}
                      </span>
                      <span class="sr-only">
                        {{
                          'brands.suggested.chainAria'
                            | rokuT
                              : {
                                  name: names.nameOf(chain.supermarketId),
                                  count: count(chain.productCount),
                                }
                        }}
                      </span>
                    </a>
                  </li>
                }
              </ul>

              <button
                (click)="startRegister(row)"
                [attr.aria-expanded]="openKey() === row.key"
                [attr.data-register]="row.key"
                class="primary"
                type="button"
              >
                {{ 'brands.suggested.register.action' | rokuT }}
              </button>

              @if (openKey() === row.key) {
                <ng-container [ngTemplateOutlet]="panel" />
              }
            </article>
          </li>
        }
      </ul>
    } @else {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              @if (selecting()) {
                <th class="pick-cell" scope="col">
                  <span class="sr-only">{{
                    'brands.suggested.bulk.selectColumn' | rokuT
                  }}</span>
                </th>
              }
              <th scope="col">{{ 'brands.suggested.brand' | rokuT }}</th>
              <th class="figure" scope="col">
                {{ 'brands.suggested.products' | rokuT }}
              </th>
              <th scope="col">{{ 'brands.suggested.firstSeen' | rokuT }}</th>
              <th scope="col">{{ 'brands.suggested.chains' | rokuT }}</th>
              <th scope="col">
                <span class="sr-only">{{
                  'resource.list.actions' | rokuT
                }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr [class.picked]="isPicked(row.key)">
                @if (selecting()) {
                  <td class="pick-cell">
                    <input
                      (change)="toggle(row)"
                      [attr.aria-label]="
                        'brands.suggested.bulk.selectRow'
                          | rokuT: { name: row.spelling }
                      "
                      [checked]="isPicked(row.key)"
                      [disabled]="
                        !isPicked(row.key) && pickedCount() >= batchMax
                      "
                      type="checkbox"
                      data-pick
                    />
                  </td>
                }
                <th scope="row">
                  <span class="stack">
                    <span class="spelling">{{ row.spelling }}</span>
                    <span class="key">{{ row.key }}</span>
                  </span>
                </th>
                <td class="figure">{{ count(row.productCount) }}</td>
                <td>
                  <!-- The date over its age, as the brand sits over its key.
                       Two bare spans side by side touched, because Angular
                       drops the whitespace between two elements. -->
                  <span class="stack">
                    <span>{{ instant(row.firstSeenAt) }}</span>
                    <span class="muted">{{ since(row.firstSeenAt) }}</span>
                  </span>
                </td>
                <td>
                  <ul class="chips">
                    @for (chain of row.chains; track chain.supermarketId) {
                      <li>
                        <a
                          [queryParams]="{
                            supermarketId: chain.supermarketId,
                            brandKey: row.key,
                          }"
                          [routerLink]="entriesLink"
                          class="chip"
                        >
                          <span aria-hidden="true">
                            {{
                              'brands.suggested.chain'
                                | rokuT
                                  : {
                                      name: names.nameOf(chain.supermarketId),
                                      count: count(chain.productCount),
                                    }
                            }}
                          </span>
                          <span class="sr-only">
                            {{
                              'brands.suggested.chainAria'
                                | rokuT
                                  : {
                                      name: names.nameOf(chain.supermarketId),
                                      count: count(chain.productCount),
                                    }
                            }}
                          </span>
                        </a>
                      </li>
                    }
                  </ul>
                </td>
                <td>
                  <button
                    (click)="startRegister(row)"
                    [attr.aria-expanded]="openKey() === row.key"
                    [attr.data-register]="row.key"
                    type="button"
                  >
                    {{ 'brands.suggested.register.action' | rokuT }}
                  </button>
                </td>
              </tr>

              @if (openKey() === row.key) {
                <tr class="panel-row">
                  <td [attr.colspan]="selecting() ? 6 : 5">
                    <ng-container [ngTemplateOutlet]="panel" />
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }

    @if (hasMore() && !reviewing()) {
      <button
        (click)="loadMore()"
        [disabled]="loadingMore()"
        class="more"
        type="button"
      >
        {{
          (loadingMore() ? 'resource.list.loadingMore' : 'resource.action.more')
            | rokuT
        }}
      </button>
    }

    <!-- One panel, drawn under whichever row is open. Written once rather than
         twice, because a table row and a card are two places the same decision
         is made and a second copy is a second thing to get wrong. -->
    <ng-template #panel>
      <!-- The panel carries the Escape handler, so it has to be focusable: a
           handler on an element nothing can focus is a control only a mouse can
           reach. That is also what makes the panel reachable to be announced. -->
      <section
        (keydown.escape)="cancel()"
        [attr.aria-label]="'brands.suggested.register.panel' | rokuT"
        class="panel"
        role="group"
        tabindex="-1"
      >
        <label>
          <span>{{ 'brands.suggested.register.label' | rokuT }}</span>
          <input
            (input)="onLabel($event)"
            [value]="label()"
            type="text"
            data-label
          />
        </label>

        <!-- The name starts capitalized, so the chain's own spelling is the one
             a press brings back, and each button is disabled while the name
             already is what it would write. -->
        <div class="controls">
          <button
            (click)="capitalize()"
            [disabled]="saving() || label() === capitalized()"
            type="button"
            data-capitalize
          >
            {{ 'brands.suggested.register.capitalize' | rokuT }}
          </button>
          <button
            (click)="revert()"
            [disabled]="saving() || label() === original()"
            type="button"
            data-revert
          >
            {{ 'brands.suggested.register.revert' | rokuT }}
          </button>
        </div>

        <p aria-live="polite" class="live-key">
          @if (liveKey() === '') {
            {{ 'brands.suggested.register.noKey' | rokuT }}
          } @else {
            {{
              'brands.suggested.register.makesKey' | rokuT: { key: liveKey() }
            }}
          }
          <!-- A name that makes a different key no longer leaves the products
               behind: the register links the suggestion to the name instead, so
               the line says what is about to happen rather than warning. -->
          @if (keyDiffers()) {
            <span class="warn">{{
              'brands.suggested.register.linksTo'
                | rokuT: { spelling: original(), label: label() }
            }}</span>
          }
        </p>

        <div class="field">
          <span>{{ 'brands.suggested.register.privateLabel' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="chainId.set($event)"
            [controlId]="'suggestion-chain'"
            [lookup]="references"
            [nullable]="true"
            [resource]="'supermarkets'"
            [value]="chainId()"
          />
        </div>

        @if (panelErrorKey(); as key) {
          <p class="failure" role="alert">
            {{ key | rokuT }}
            @if (holderLink(); as link) {
              <a [routerLink]="link">{{
                'brands.suggested.register.openHolder' | rokuT
              }}</a>
            }
          </p>
        }

        <div class="controls">
          <button
            (click)="register()"
            [disabled]="saving() || liveKey() === ''"
            class="primary"
            type="button"
            data-confirm
          >
            {{
              (saving()
                ? 'resource.action.working'
                : keyDiffers()
                  ? 'brands.suggested.register.confirmLink'
                  : 'brands.suggested.register.confirm'
              ) | rokuT
            }}
          </button>
          <button
            (click)="cancel()"
            [disabled]="saving()"
            type="button"
            data-cancel
          >
            {{ 'resource.action.cancel' | rokuT }}
          </button>
        </div>
      </section>
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: flex-start;
    }

    header {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    h2 {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      font-size: 1rem;
    }

    .lead,
    .state,
    .muted {
      color: var(--admin-ink-muted);
    }

    .state {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    /* The second sentence of the notice, on its own line: it is about the chain
       picker rather than about what was registered. */
    .kept {
      display: block;
    }

    .done {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .failure {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .search,
    .field,
    .panel label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      max-inline-size: 24rem;
    }

    .search > span,
    .field > span,
    .panel label span,
    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .table-wrap {
      overflow-x: auto;
      inline-size: 100%;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    thead th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody th {
      font-weight: 400;
    }

    /* A wrapper rather than a flex table cell: display flex on a th takes it
       out of the table layout, and the column stops lining up with its
       header. */
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .bulk-bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .bulk-count {
      display: flex;
      flex-direction: column;
      font-variant-numeric: tabular-nums;
    }

    .pick-cell {
      inline-size: 2.75rem;
    }

    .pick {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
    }

    input[type='checkbox'] {
      inline-size: 1.25rem;
      block-size: 1.25rem;
      min-block-size: 0;
      accent-color: var(--admin-accent);
    }

    tr.picked th,
    tr.picked td,
    article.picked {
      background: var(--admin-accent-wash);
    }

    .review,
    .batch-result {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      inline-size: 100%;
      max-inline-size: 48rem;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .batch-result {
      border-color: var(--admin-border);
    }

    .review-lines,
    .batch-result ul {
      display: flex;
      flex-direction: column;
      inline-size: 100%;
      list-style: none;
    }

    .review-lines li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding-block: var(--admin-space-3);
      border-block-start: 1px solid var(--admin-border);
    }

    .review-head {
      display: flex;
      gap: var(--admin-space-3);
      align-items: flex-start;
      justify-content: space-between;
    }

    .review label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      max-inline-size: 24rem;
    }

    .review label span {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .warn-line {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-status-attention);
      border-radius: var(--admin-radius);
      background: var(--admin-status-attention-wash);
      color: var(--admin-status-attention-on-wash);
    }

    .batch-result li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: baseline;
      padding-block: var(--admin-space-2);
    }

    .batch-result .refused {
      font-weight: 600;
      color: var(--admin-danger);
    }

    .batch-result .detail {
      flex-basis: 100%;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .panel-row td {
      background: var(--admin-surface);
    }

    .spelling {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    /* The key, in the muted monospace a key wears everywhere in this app. */
    .key,
    .live-key {
      font-family: monospace;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .figure {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      inline-size: 100%;
      list-style: none;
    }

    .cards article {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    /* Every chain, wrapping onto a second line rather than truncating: a chain
       hidden behind a count is a fact moved out of the row. */
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .chip {
      padding: var(--admin-space-1) var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      font-size: 0.8125rem;
      white-space: nowrap;
    }

    /* A chip is a link now, and keeps its shape: inline-block so the padding
       still makes one, the page's own ink rather than a browser blue, and the
       underline kept for the hover and the focus, where it says this is a link
       rather than a label. */
    a.chip {
      display: inline-block;
      color: inherit;
      text-decoration: none;
    }

    a.chip:hover,
    a.chip:focus-visible {
      text-decoration: underline;
    }

    a.chip:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      inline-size: 100%;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .warn {
      display: block;
      font-family: inherit;
      color: var(--admin-ink);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    input {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .sr-only {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandSuggestionsPage implements OnDestroy {
  private readonly _brands = inject(BrandsGateway);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _viewport = inject(Viewport);

  /** What a chain is called, resolved once per id. */
  readonly names = inject(ChainNames);

  /** How the private label picker finds a chain by name. */
  readonly references = inject(ResourceReferences);

  readonly compact = this._viewport.compact;

  readonly rows = signal<readonly BrandSuggestion[]>([]);
  readonly query = signal('');
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly failed = signal(false);
  private readonly _cursor = signal<string | null>(null);
  private readonly _error = signal<GatewayError | null>(null);

  readonly errorKey = computed(
    () => gatewayErrorKey(this._error()) ?? 'resource.error.unknown'
  );
  readonly hasMore = computed(() => this._cursor() !== null);

  /** Which row's panel is open, by key. `null` when none is. */
  readonly openKey = signal<string | null>(null);
  readonly label = signal('');
  /** The open row's spelling as the chain printed it, which revert restores. */
  readonly original = signal('');
  readonly capitalized = computed(() => capitalizeBrand(this.label()));
  readonly chainId = signal('');
  readonly saving = signal(false);
  private readonly _panelError = signal<GatewayError | null>(null);

  /**
   * What the last register did, until the next one starts.
   *
   * The parts rather than a finished sentence, because this screen draws its own
   * notice and can interpolate them where they are read. `spelling` is the
   * linked brand's name, and `null` when the typed name made the suggestion's
   * own key and there was nothing to link.
   */
  readonly done = signal<{
    readonly label: string;
    readonly spelling: string | null;
    readonly linked: number;
    readonly chainKept: boolean;
  } | null>(null);

  /**
   * Where a chain chip goes: the source products queue, filtered.
   *
   * `HARVEST_SEGMENT` and a plain segment, because the entries queue is a hand
   * written screen rather than a resource, and `ResourceRegistry.pathOf` only
   * answers for resources. No status on the link: the queue's own default is
   * `CANDIDATE` and `UNRESOLVED`, which is exactly what the chip counted, so the
   * list it opens holds the number it showed.
   */
  readonly entriesLink: readonly string[] = ['/', HARVEST_SEGMENT, 'entries'];

  /**
   * The key this label would make, live.
   *
   * The same `brandKey` catalog, the harvester and the gateway use, so what the
   * panel shows is what the server will store rather than an approximation of
   * it. Empty means the label makes no key at all, which is what `-` and `---`
   * do, and the register button is disabled rather than sending a request whose
   * only possible answer is `brand_label_empty`.
   */
  readonly liveKey = computed(() => brandKey(this.label()) ?? '');

  /**
   * Whether the label being typed makes a key of its own.
   *
   * The whole reason the panel prefills the spelling and lets it be edited is
   * that `MAHOU` should become `Mahou`. Both make `mahou`, so both are one
   * register and one brand. `Mahou 5 Estrellas` is not: that name is its own
   * brand, and this row becomes a spelling of it (backend plan 0124, section 5).
   * It used to be a warning, because the products were left behind; now it is
   * what the register is about to do, said before it happens.
   */
  readonly keyDiffers = computed(() => {
    const open = this.openKey();
    return open !== null && this.liveKey() !== '' && this.liveKey() !== open;
  });

  readonly panelErrorKey = computed(() => gatewayErrorKey(this._panelError()));

  /**
   * Where the brand this refusal named lives, or nothing.
   *
   * Two refusals name one: the key is already taken, or the name typed is
   * itself a spelling of something and linking to it would make a chain. The
   * second only happens when somebody linked that brand between this panel
   * being opened and the press, and both leave the operator wanting the same
   * thing, which is to look at the brand in question.
   *
   * Built from `ResourceRegistry.pathOf`, never from the segment: where a
   * resource is mounted is its section's business, and a link written by hand
   * here would break the day the section moves.
   */
  readonly holderLink = computed<readonly string[] | null>(() => {
    const error = this._panelError();
    if (
      error === null ||
      (error.code !== 'brand_key_taken' && error.code !== 'brand_link_too_deep')
    ) {
      return null;
    }

    const brandId = error.detailString(BRAND_KEY_HOLDER_DETAIL);
    const path = this._registry.pathOf('brands');

    return brandId === null || path === null ? null : [...path, brandId];
  });

  private _timer: ReturnType<typeof setTimeout> | null = null;

  /** The most names one batch may carry. */
  readonly batchMax = BRAND_BATCH_MAX;

  /** Whether rows draw a tick box. */
  readonly selecting = signal(false);

  /**
   * The rows ticked for a batch, by key, in the order they were ticked.
   *
   * Held apart from `rows` so a search or a second page never drops a tick:
   * the spelling travels with it, because the review draws it whether or not
   * the row is on screen.
   */
  readonly picked = signal<ReadonlyMap<string, PickedBrand>>(new Map());
  readonly pickedCount = computed(() => this.picked().size);

  /** Whether the review step is open. The only place a batch is sent from. */
  readonly reviewing = signal(false);
  readonly sendingBatch = signal(false);
  private readonly _batchError = signal<GatewayError | null>(null);
  readonly batchErrorKey = computed(() => gatewayErrorKey(this._batchError()));

  /** What the last batch answered, name by name, until the next one starts. */
  readonly batch = signal<readonly BatchLine[] | null>(null);

  /**
   * The review, one line per ticked row, with what each label would make.
   *
   * A label that makes the row's own key is sent. One that makes no key, or a
   * different key, is held back with a sentence: the batch registers names as
   * they are, so a different key would register another brand and leave this
   * suggestion where it was.
   */
  readonly reviewLines = computed<readonly ReviewLine[]>(() =>
    [...this.picked().values()].map((picked) => {
      const liveKey = brandKey(picked.label) ?? '';
      const problem: ReviewProblem =
        liveKey === '' ? 'noKey' : liveKey !== picked.key ? 'keyDiffers' : null;
      return { ...picked, liveKey, problem };
    })
  );

  readonly canSend = computed(
    () =>
      !this.sendingBatch() &&
      this.reviewLines().length > 0 &&
      this.reviewLines().every((line) => line.problem === null)
  );

  constructor() {
    void this._load();
  }

  ngOnDestroy(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
  }

  /** A count, through `Intl`, like every other figure in this app. */
  count(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  instant(value: string): string {
    return formatInstant(value);
  }

  since(value: string): string {
    return formatSince(value, Date.now());
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);

    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._load();
    }, SEARCH_DELAY_MS);
  }

  onLabel(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
  }

  /** Write the name with only the first letter of each word in capitals. */
  capitalize(): void {
    this.label.set(this.capitalized());
  }

  /** Put back the spelling the chain printed. */
  revert(): void {
    this.label.set(this.original());
  }

  reload(): void {
    void this._load();
  }

  loadMore(): void {
    void this._loadMore();
  }

  /**
   * Open the panel under one row, with its spelling already capitalized in the
   * label. Chains mostly print brands in capitals, so the capitalized name is
   * the one a person keeps far more often than the printed one.
   */
  startRegister(row: BrandSuggestion): void {
    this.openKey.set(row.key);
    this.original.set(row.spelling);
    this.label.set(capitalizeBrand(row.spelling));
    this.chainId.set('');
    this._panelError.set(null);
    this.done.set(null);
    this._focusLater('[data-label]');
  }

  /** Close the panel, and put focus back on the button that opened it. */
  cancel(): void {
    const open = this.openKey();
    this.openKey.set(null);
    this._panelError.set(null);
    if (open !== null) {
      this._focusLater(`[data-register="${cssValue(open)}"]`);
    }
  }

  /**
   * Register the open row, as a brand or as a spelling of one.
   *
   * **One request either way.** The route takes the suggestion's spelling and
   * the typed name and decides between the two: the same key is an ordinary
   * create, and a different one creates the brand the name spells, registers
   * this row beside it and links them. Two requests from here would leave a
   * suggestion half registered whenever the second one failed.
   *
   * The spelling posted is the chain's, capitalized, which is what the linked
   * brand ends up called: `DEBORAH 48H` is a shout, not a name.
   *
   * On success the row leaves the list, because it is no longer a suggestion:
   * the key is registered, so the read it came from would not answer it again.
   * Focus moves to the next row's button, or to the search box when there is no
   * next row, so working through the queue never needs the mouse.
   */
  async register(): Promise<void> {
    const open = this.openKey();
    if (open === null || this.saving()) {
      return;
    }

    this.saving.set(true);
    this._panelError.set(null);

    try {
      const chainId = this.chainId();
      const registered = await this._brands.registerSuggestion(
        capitalizeBrand(this.original()),
        this.label(),
        chainId === '' ? null : chainId
      );

      const remaining = this.rows().filter((row) => row.key !== open);
      const next = this._keyAfter(open);

      this.rows.set(remaining);
      this.openKey.set(null);
      this.done.set({
        label: registered.brand.label,
        spelling: registered.linked?.label ?? null,
        linked: registered.linkedItems,
        // A chain was picked, the name made a brand of its own, and that brand
        // was already registered, so the chain that counts is the one it had.
        // `linked` first, because `canonicalCreated` is true for the same key
        // case as well and nothing was ignored there.
        chainKept:
          chainId !== '' &&
          registered.linked !== null &&
          !registered.canonicalCreated,
      });

      this._focusLater(
        next === null ? '[data-search]' : `[data-register="${cssValue(next)}"]`
      );
    } catch (error) {
      // The panel stays open, holding everything typed. A refused register is a
      // decision to make again, not one to make from scratch.
      this._panelError.set(error as GatewayError);
    } finally {
      this.saving.set(false);
    }
  }

  /** Draw a tick box on every row. */
  startSelecting(): void {
    this.openKey.set(null);
    this.selecting.set(true);
  }

  /** Put the tick boxes away and forget what was ticked. */
  stopSelecting(): void {
    this.selecting.set(false);
    this.reviewing.set(false);
    this.picked.set(new Map());
    this._batchError.set(null);
    this._focusLater('[data-select-mode]');
  }

  isPicked(key: string): boolean {
    return this.picked().has(key);
  }

  /**
   * Tick or untick one row.
   *
   * The label starts capitalized, as the single panel's does, because that is
   * the one a person keeps far more often than the chain's capitals.
   */
  toggle(row: BrandSuggestion): void {
    const next = new Map(this.picked());
    if (next.has(row.key)) {
      next.delete(row.key);
    } else if (next.size < this.batchMax) {
      next.set(row.key, {
        key: row.key,
        spelling: row.spelling,
        label: capitalizeBrand(row.spelling),
      });
    }
    this.picked.set(next);
  }

  /** Take one name out of the batch, from the review. */
  unpick(key: string): void {
    const next = new Map(this.picked());
    next.delete(key);
    this.picked.set(next);
  }

  /** Change the label one ticked row will be registered under. */
  relabel(key: string, event: Event): void {
    const current = this.picked().get(key);
    if (current === undefined) {
      return;
    }
    const next = new Map(this.picked());
    next.set(key, {
      ...current,
      label: (event.target as HTMLInputElement).value,
    });
    this.picked.set(next);
  }

  /** Open the review. Nothing is sent yet. */
  review(): void {
    if (this.pickedCount() === 0) {
      return;
    }
    this.openKey.set(null);
    this.batch.set(null);
    this.done.set(null);
    this._batchError.set(null);
    this.reviewing.set(true);
    this._focusLater('[data-review-panel]');
  }

  /** Close the review and go back to ticking, keeping every tick and label. */
  backToList(): void {
    if (this.sendingBatch()) {
      return;
    }
    this.reviewing.set(false);
    this._batchError.set(null);
    this._focusLater('[data-review]');
  }

  /**
   * Send the reviewed batch, one request for every name on it.
   *
   * What was registered, or already was, leaves the list and the selection,
   * because its key is held now and the suggestions read would not answer it
   * again. A refused name **stays ticked**, holding its label, so correcting it
   * and reviewing again is a second pass over what failed rather than a new
   * one. A request refused as a whole changes nothing and keeps the review
   * open.
   */
  async sendBatch(): Promise<void> {
    if (!this.canSend()) {
      return;
    }
    const lines = this.reviewLines();

    this.sendingBatch.set(true);
    this._batchError.set(null);
    try {
      const results = await this._brands.registerMany(
        lines.map((line) => ({ label: line.label }))
      );

      const answered: BatchLine[] = lines.map((line, index) => ({
        key: line.key,
        result: results[index] ?? {
          label: line.label,
          outcome: 'REFUSED',
          brandId: null,
          linkedItems: null,
          reasonCode: null,
          reasonDetail: null,
        },
      }));
      const held = new Set(
        answered
          .filter((line) => line.result.outcome !== 'REFUSED')
          .map((line) => line.key)
      );

      this.rows.set(this.rows().filter((row) => !held.has(row.key)));
      const kept = new Map(this.picked());
      for (const key of held) {
        kept.delete(key);
      }
      this.picked.set(kept);
      this.batch.set(answered);
      this.reviewing.set(false);
      if (kept.size === 0) {
        this.selecting.set(false);
      }
      this._focusLater('[data-batch-result]');
    } catch (error) {
      this._batchError.set(error as GatewayError);
    } finally {
      this.sendingBatch.set(false);
    }
  }

  /** Where a brand a batch named lives, or nothing. */
  brandLink(brandId: string | null): readonly string[] | null {
    const path = this._registry.pathOf('brands');
    return brandId === null || path === null ? null : [...path, brandId];
  }

  /**
   * The sentence for a refused name's code.
   *
   * The same keys the single panel reads, through the same function, so a
   * `brand_label_empty` says the same thing whichever way it was refused.
   */
  reasonKey(code: string | null): string {
    return (
      gatewayErrorKey(
        new GatewayError({ code: code ?? '', status: 400, correlationId: '' })
      ) ?? 'resource.error.unknown'
    );
  }

  /** The key of the row after this one, or `null` when it is the last. */
  private _keyAfter(key: string): string | null {
    const rows = this.rows();
    const at = rows.findIndex((row) => row.key === key);
    return at === -1 ? null : (rows[at + 1]?.key ?? null);
  }

  private async _load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    this.openKey.set(null);

    try {
      const page = await this._brands.suggestions(this.query());
      this.rows.set(page.items);
      this._cursor.set(page.nextCursor);
      void this.names.resolve(chainIdsOf(page.items));
    } catch (error) {
      this._error.set(error as GatewayError);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The next page, appended and deduped by key.
   *
   * The cursor is a keyset over `(productCount, key)` and the counts move as the
   * queue is worked, so a row really can arrive on two pages (backend plan 0115,
   * section 7.2). Dropping the repeat is the reader's job.
   */
  private async _loadMore(): Promise<void> {
    const cursor = this._cursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const page = await this._brands.suggestions(this.query(), cursor);
      const seen = new Set(this.rows().map((row) => row.key));

      this.rows.set([
        ...this.rows(),
        ...page.items.filter((row) => !seen.has(row.key)),
      ]);
      this._cursor.set(page.nextCursor);
      void this.names.resolve(chainIdsOf(page.items));
    } catch (error) {
      this._error.set(error as GatewayError);
      this.failed.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /**
   * Move focus to an element this render has not drawn yet.
   *
   * `afterNextRender` rather than a timer or a microtask, and the difference is
   * the whole of it: the panel opening and the row leaving are signal writes, so
   * the element being focused does not exist until the view is redrawn. A
   * microtask queued beside the write can run first and find the old DOM, and a
   * timer is the same race with a longer fuse.
   */
  private _focusLater(selector: string): void {
    afterNextRender(
      () => {
        this._host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this._injector }
    );
  }
}

/** Every chain named on a page of suggestions, without repeats. */
function chainIdsOf(rows: readonly BrandSuggestion[]): readonly string[] {
  return [
    ...new Set(
      rows.flatMap((row) => row.chains.map((chain) => chain.supermarketId))
    ),
  ];
}

/**
 * A key, safe inside an attribute selector.
 *
 * `brandKey` leaves only letters and digits, so nothing here needs escaping
 * today. It is quoted anyway, because a selector built from a value is exactly
 * where an assumption about that value stops being true quietly.
 */
function cssValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
