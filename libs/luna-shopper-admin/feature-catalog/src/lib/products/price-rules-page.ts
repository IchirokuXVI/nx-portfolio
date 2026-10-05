import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  RecordStore,
  RESOURCE_GATEWAYS,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  LeaveQuestion,
  RecordView,
  ResourceChanges,
  type LeaveAware,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  nounKeyOf,
  type AnyResourceDescriptor,
  type InfoContent,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import { PRICE_SOURCE_KIND_OPTIONS } from '../catalog-enums';
import { pricePolicySource } from '../catalog-sources';
import { PRICE_POLICIES, type PricePolicy } from '../price-policies';

/**
 * What the info button of the price rules says (admin plan 0043, target 9):
 * the three points of the `Phone-Info` board, and the caution, because the
 * switch on a row saves a rule with no form in between.
 */
export const PRICE_RULES_INFO: InfoContent = {
  title: 'catalog.pricePolicies.many',
  points: [
    'catalog.pricePolicies.info.wins',
    'catalog.pricePolicies.info.age',
    'catalog.pricePolicies.info.off',
  ],
  caution: 'catalog.pricePolicies.caution',
};

/** One rule, as a row of the page. */
export interface PriceRuleRow {
  /** The source kind, which is the rule's id. */
  readonly id: string;
  /** Where the rule ranks, 1 the highest. */
  readonly rank: number;
  /** The source, already translated. */
  readonly source: string;
  /** How many days a price of the source stays current, or `null` for always. */
  readonly maxAgeDays: number | null;
  readonly enabled: boolean;
}

/**
 * The rules in rank order: the lower priority number wins, so it ranks first.
 * Two rules with the same number keep the order the gateway gave them.
 */
export function toPriceRuleRows(
  policies: readonly PricePolicy[],
  sourceName: (kind: string) => string
): PriceRuleRow[] {
  return [...policies]
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((policy, index) => ({
      id: policy.sourceKind,
      rank: index + 1,
      source: sourceName(policy.sourceKind),
      maxAgeDays: policy.maxAgeDays ?? null,
      enabled: policy.enabled !== false,
    }));
}

/**
 * The price rules (admin plan 0043, target 6): how each kind of source
 * competes for the price a shopper sees.
 *
 * Six fixed rows, in rank order. A row says where the source ranks, what the
 * source is, how long one of its prices stays current, and whether the rule
 * is on. The switch turns the rule on or off at once. Pressing the row opens
 * its form under it, in place, for the rank and the limit.
 *
 * It was a list of six rows that led to six pages. The six rows are now the
 * whole screen, and a form is part of its row.
 *
 * **What a rule does is the server's.** This page changes the three columns
 * of a rule and reads the rows again. It works out no price.
 *
 * The open form is a child route, so an open rule has an address and the
 * browser's back button closes it.
 */
@Component({
  selector: 'lib-price-rules-page',
  imports: [PageHeader, RouterOutlet, ChevronLeftIcon, RokuTranslatorPipe],
  template: `
    <lib-page-header
      [heading]="'catalog.pricePolicies.many' | rokuT"
      [info]="info"
    />

    @if (errorKey(); as key) {
      <div class="state error" role="alert">
        <p>{{ key | rokuT }}</p>
        <button (click)="load()" class="button" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else if (loading() && rows().length === 0) {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else {
      @if (actionErrorKey(); as key) {
        <p class="state error" role="alert">{{ key | rokuT }}</p>
      }

      <ol class="rules">
        @for (row of rows(); track row.id) {
          <li [class.open]="openId() === row.id">
            <div class="rule">
              <button
                (click)="toggle(row.id)"
                [attr.aria-expanded]="openId() === row.id"
                [attr.data-rule]="row.id"
                class="rule-main"
                type="button"
              >
                <span class="rank">{{ row.rank }}</span>
                <span class="texts">
                  <span class="source">{{ row.source }}</span>
                  <span class="age">
                    @if (row.maxAgeDays === null) {
                      {{ 'catalog.pricePolicies.neverOld' | rokuT }}
                    } @else {
                      {{
                        'catalog.pricePolicies.oldAfter'
                          | rokuT: { count: row.maxAgeDays }
                      }}
                    }
                  </span>
                </span>
                <lib-chevron-left-icon
                  [class.down]="openId() === row.id"
                  class="twist"
                />
              </button>
              <button
                (click)="setEnabled(row, !row.enabled)"
                [attr.aria-checked]="row.enabled"
                [attr.aria-label]="
                  'catalog.pricePolicies.switch' | rokuT: { source: row.source }
                "
                [attr.data-rule-switch]="row.id"
                [class.on]="row.enabled"
                [disabled]="busyId() !== null"
                class="switch"
                role="switch"
                type="button"
              >
                <span class="knob"></span>
              </button>
            </div>

            @if (openId() === row.id) {
              <div class="form"><router-outlet /></div>
            }
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    .rules {
      display: flex;
      flex-direction: column;
      max-inline-size: 44rem;
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      list-style: none;
    }

    .rules > li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    li.open {
      background: var(--admin-surface);
    }

    .rule {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      padding-inline-end: var(--admin-space-4);
    }

    .rule-main {
      display: flex;
      flex: 1;
      gap: var(--admin-space-3);
      align-items: center;
      min-inline-size: 0;
      min-block-size: 3.25rem;
      padding: var(--admin-space-2) 0 var(--admin-space-2) var(--admin-space-4);
      border: none;
      background: none;
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .rank {
      flex: none;
      inline-size: 1.125rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .texts {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    .source {
      font-weight: 600;
    }

    .age {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    /* The one chevron the app has points back. Turned, it points right for a
       closed rule and down for an open one. */
    .twist {
      flex: none;
      inline-size: 1rem;
      block-size: 1rem;
      rotate: 180deg;
      color: var(--admin-ink-muted);
    }

    .twist.down {
      rotate: -90deg;
    }

    /* A thumb sized target around a track of 40 by 24. */
    .switch {
      position: relative;
      display: inline-flex;
      flex: none;
      align-items: center;
      inline-size: 2.5rem;
      min-block-size: var(--admin-control);
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
    }

    .switch::before {
      position: absolute;
      inline-size: 2.5rem;
      block-size: 1.5rem;
      border-radius: 0.75rem;
      background: var(--admin-border-strong);
      content: '';
    }

    .switch.on::before {
      background: var(--admin-accent);
    }

    .knob {
      position: relative;
      inline-size: 1.125rem;
      block-size: 1.125rem;
      margin-inline-start: 0.1875rem;
      border-radius: 50%;
      background: var(--admin-surface-raised);
    }

    .switch.on .knob {
      margin-inline-start: 1.1875rem;
    }

    .switch:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .form {
      padding: 0 var(--admin-space-4) var(--admin-space-4) 3.125rem;
    }

    @media (max-width: 47.99rem) {
      .form {
        padding-inline-start: var(--admin-space-4);
      }
    }

    .button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    .switch:focus-visible {
      outline-offset: 2px;
    }

    .state {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 44rem;
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border: 1px solid var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceRulesPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _changes = inject(ResourceChanges);
  private readonly _gateway =
    inject(RESOURCE_GATEWAYS).for(pricePolicySource());

  readonly info = PRICE_RULES_INFO;

  private readonly _policies = signal<readonly PricePolicy[]>([]);
  readonly loading = signal(true);
  /** Why the rules could not be read, as a key. */
  readonly errorKey = signal<string | null>(null);
  /** Why a switch could not be saved, as a key. */
  readonly actionErrorKey = signal<string | null>(null);
  /** The rule whose switch is being saved. */
  readonly busyId = signal<string | null>(null);

  /** The rule whose form is open: the id the address carries. */
  readonly openId = signal<string | null>(this._openNow());

  readonly rows = computed(() => {
    // Read so that the sources are named once the catalogue has loaded.
    this._translate.loaded();
    return toPriceRuleRows(this._policies(), (kind) => {
      const option = PRICE_SOURCE_KIND_OPTIONS.find(
        (entry) => entry.value === kind
      );
      return option === undefined ? kind : this._translate.t(option.label);
    });
  });

  constructor() {
    void this.load();

    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.openId.set(this._openNow());
      }
    });
    inject(DestroyRef).onDestroy(() => events.unsubscribe());

    // A rule was saved in its form: the rows are read again.
    let seen = this._changes.version(PRICE_POLICIES.name);
    effect(() => {
      const version = this._changes.version(PRICE_POLICIES.name);
      untracked(() => {
        if (version !== seen) {
          seen = version;
          void this.load();
        }
      });
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const page = await this._gateway.list({});
      this._policies.set(page.items);
    } catch (error) {
      this.errorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** Open a rule's form under its row, or close the one that is open. */
  toggle(id: string): void {
    void this._router.navigate(this.openId() === id ? ['.'] : [id], {
      relativeTo: this._route,
    });
  }

  /** Turn a rule on or off. The rows are read again from what was saved. */
  async setEnabled(row: PriceRuleRow, enabled: boolean): Promise<void> {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(row.id);
    this.actionErrorKey.set(null);
    try {
      await this._gateway.update(row.id, { enabled });
      // Seen first, so that this page reads once and not twice.
      this._changes.wrote(PRICE_POLICIES.name);
    } catch (error) {
      this.actionErrorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.busyId.set(null);
    }
  }

  private _openNow(): string | null {
    return this._route.snapshot.firstChild?.url[0]?.path ?? null;
  }
}

/**
 * The form of one price rule, drawn under its row (admin plan 0043, target
 * 6, and admin plan 0060, section 2.1).
 *
 * The view of the record page with no page around it. The row above says
 * which rule it is, so there is no header and no Record block, and the bar
 * is the last line of the row and not the edge of the window.
 *
 * **It opens as a form at once.** A record opens to be read everywhere else.
 * A row that was opened to change the rule already answered that question,
 * and a second press on "Edit" inside the row would only be in the way.
 *
 * It draws the two columns a rule can change here, the rank and the limit,
 * and the caution, because saving works out the shown price of every product
 * again. Whether the rule is on is the switch on the row, and the form does
 * not ask it a second time (admin plan 0049). Saving and cancelling both
 * close the row, and leaving it with changes asks first.
 */
@Component({
  selector: 'lib-price-rule-form',
  imports: [RecordView, ConfirmDialog, RokuTranslatorPipe],
  template: `
    @if (store.status() === 'error') {
      <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
    } @else if (store.status() === 'missing') {
      <p class="state" role="status">
        {{ 'record.state.missing.body' | rokuT: { name: noun() } }}
      </p>
    } @else {
      <lib-record-view
        (cancel)="close()"
        (saved)="close()"
        [descriptor]="descriptor"
        [facts]="false"
        [stickyBar]="false"
        [store]="store"
      />
    }

    @if (leave.asking()) {
      <lib-confirm-dialog
        (confirm)="leave.answer(true)"
        (dismiss)="leave.answer(false)"
        [bodyArgs]="leaveArgs()"
        bodyKey="record.leave.body"
        confirmKey="resource.confirm.discard.confirm"
        dismissKey="record.leave.stay"
        headingKey="resource.confirm.discard.heading"
        prefer="dismiss"
        data-leave
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    .state {
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceRuleForm implements LeaveAware {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _changes = inject(ResourceChanges);

  readonly descriptor: AnyResourceDescriptor = PRICE_POLICIES;

  /** The rule the row is of: its source kind, which the address holds. */
  private readonly _id = this._route.snapshot.paramMap.get('id');

  readonly store = new RecordStore<ResourceRow>(
    this.descriptor,
    this.descriptor.gateway(),
    this._id
  );

  /** The question asked before a row with changes is left. */
  readonly leave = new LeaveQuestion(() => this.store.changed().length > 0);

  /** Drawn only while the read failed, so the fallback is for the type. */
  readonly errorKey = computed(
    () => gatewayErrorKey(this.store.error()) ?? 'resource.error.unknown'
  );

  /** What one row is called inside a sentence: "price rule". */
  readonly noun = computed(() => this._t(nounKeyOf(this.descriptor)));

  /** How much would be lost, and of which rule: its source, in words. */
  readonly leaveArgs = computed(() => {
    const option = PRICE_SOURCE_KIND_OPTIONS.find(
      (entry) => entry.value === this._id
    );
    return {
      count: this.store.changed().length,
      name: option === undefined ? (this._id ?? '') : this._t(option.label),
    };
  });

  constructor() {
    // Said by the store and not by the view: a save that answers after the
    // row was closed still wrote the rule, and the rows have to be read
    // again.
    this.store.onSaved(() => this._changes.wrote(this.descriptor.name));

    // Straight into the form. `edit` does nothing when the read failed.
    void this.store.load().then(() => this.store.edit());
  }

  canLeave(): boolean | Promise<boolean> {
    return this.leave.canLeave();
  }

  /**
   * Close the row: one route up, which is the rules with no row open. After a
   * save there is nothing to lose. After Cancel with something typed, the
   * guard of the route asks.
   */
  close(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }

  /**
   * One key, translated now and again when the words arrive. `t` reads no
   * signal, so without the two reads a `computed` that ran before the
   * catalogue was loaded would hold the raw key for good.
   */
  private _t(key: string): string {
    this._translator.loaded();
    this._translator.locale();
    return this._translator.t(key);
  }
}
