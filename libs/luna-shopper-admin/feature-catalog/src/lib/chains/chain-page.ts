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
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  PageHeader,
  Viewport,
  type PageTab,
} from '@portfolio/luna-shopper-admin/ui';
import { ChainContext } from './chain-context';

/** The route parameter that holds the chain. */
export const CHAIN_PARAM = 'chainId';

/**
 * The segment of the Details tab, of a chain and of a shop alike. The one tab
 * that is not a resource of its own: it is the form of the row the page is
 * about.
 */
export const DETAILS_TAB = 'details';

/** What the info button of a chain's page says (admin plan 0042, target 10). */
export const CHAIN_INFO: InfoContent = {
  title: 'catalog.chains.info.title',
  points: ['catalog.chains.info.holds', 'catalog.chains.info.openShop'],
};

/**
 * One chain, as a page (admin plan 0042, target 3).
 *
 * The header says which chain and whether the harvester fetches it. Under it
 * are the four things a chain holds, as tabs: its shops, its sections, its
 * price scopes and its own details. Each tab is a child route, so each has an
 * address and the browser's back button walks them.
 *
 * It replaced four screens in one flat row. Three of them could not load until
 * a chain was picked in a filter, and the chain is now the address they sit
 * under.
 *
 * **The tabs are drawn again when the chain changes.** On a wide screen the
 * chains are a column beside this page, and pressing another one changes only
 * a route parameter: the router keeps every component it can. A list that read
 * the old chain's shops would go on showing them. So what is under the tabs is
 * keyed on the chain, and a new chain builds it again from the new address.
 */
@Component({
  selector: 'lib-chain-page',
  imports: [
    PageHeader,
    RouterOutlet,
    RouterLink,
    ConfirmDialog,
    RokuTranslatorPipe,
  ],
  providers: [ChainContext],
  template: `
    <!-- While a shop is open on a narrow screen the shop is the page, and its
         own header stands where this one did. -->
    <div [class.under-shop]="shopOpen()" class="chain-head">
      <lib-page-header
        [backLabel]="split() ? null : ('catalog.chains.back' | rokuT)"
        [backLink]="listPath"
        [heading]="name() || ('resource.form.loading' | rokuT)"
        [info]="info"
        [tabs]="tabs()"
        [tabsLabel]="name()"
      >
        @switch (chain.source()) {
          @case ('fetched') {
            <span class="chip good" pageChip data-source="fetched">{{
              'catalog.chains.source.fetched' | rokuT
            }}</span>
          }
          @case ('off') {
            <span class="chip" pageChip data-source="off">{{
              'catalog.chains.source.off' | rokuT
            }}</span>
          }
          @case ('none') {
            <span class="chip" pageChip data-source="none">{{
              'catalog.chains.source.none' | rokuT
            }}</span>
          }
        }
        <a [routerLink]="detailsPath()" class="button" pageMoreAction>{{
          'catalog.chains.edit' | rokuT
        }}</a>
        <button
          (click)="deleting.set(true)"
          class="button danger"
          pageMoreAction
          type="button"
        >
          {{ 'catalog.chains.delete' | rokuT }}
        </button>
      </lib-page-header>
    </div>

    @if (refusalKey(); as key) {
      <p class="refusal" role="alert">
        {{ key | rokuT: { name: name() } }}
        <button (click)="refusalKey.set(null)" type="button">
          {{ 'resource.action.dismiss' | rokuT }}
        </button>
      </p>
    }

    @if (chain.status() === 'error') {
      <p class="state error" role="alert">
        {{ chain.errorKey() ?? 'resource.error.unknown' | rokuT }}
      </p>
    } @else {
      @for (key of keys(); track key) {
        <div class="chain-body"><router-outlet /></div>
      }
    }

    @if (deleting()) {
      <lib-confirm-dialog
        (confirm)="confirmDelete()"
        (dismiss)="deleting.set(false)"
        [bodyArgs]="{ name: name() }"
        [busy]="removing()"
        bodyKey="catalog.chains.deleteBody"
        confirmKey="catalog.chains.deleteConfirm"
        headingKey="catalog.chains.deleteHeading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    .chain-body {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
      padding-block-start: var(--admin-page-block);
    }

    /* The Shops tab is a split that draws its own edges. */
    .chain-body:has(> lib-resource-split-page) {
      padding-block-start: 0;
    }

    @media (max-width: 71.99rem) {
      .chain-head.under-shop {
        display: none;
      }
    }

    .chip {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .chip.good {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
    }

    .button:focus-visible,
    .refusal > button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .state {
      margin-block-start: var(--admin-page-block);
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .refusal {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .refusal > button {
      margin-inline-start: auto;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _viewport = inject(Viewport);

  readonly chain = inject(ChainContext);

  readonly info = CHAIN_INFO;
  readonly split = this._viewport.split;

  /** Where the list of chains is, for the way back on a narrow screen. */
  readonly listPath = this._registry.pathOf('supermarkets') ?? ['/'];

  /** The chain as a one entry list, so that the template can key on it. */
  readonly keys = computed(() => {
    const id = this.chain.id();
    return id === null ? [] : [id];
  });

  readonly name = computed(() => {
    const row = this.chain.chain();
    return row === null
      ? ''
      : localizedTextValue(row.name, this._content.order());
  });

  /**
   * Whether a shop is open under the Shops tab: a route two levels down.
   *
   * Written by hand from the router's events, for the reason `AdminShellPage`
   * gives.
   */
  readonly shopOpen = signal(this._isShopOpen());

  readonly deleting = signal(false);
  readonly removing = signal(false);
  /** A delete the gateway refused, said under the header. */
  readonly refusalKey = signal<string | null>(null);

  readonly detailsPath = computed(() => [...this._path(), DETAILS_TAB]);

  /**
   * The four tabs. Shops, Sections and Price scopes show a count, and each
   * shows it only when the gateway gave one.
   */
  readonly tabs = computed<readonly PageTab[]>(() => {
    const context = this.chain;
    // Each tab is where the registry says that resource is under this chain,
    // so a tab cannot point at an address the route table does not have.
    const under = (resource: string): readonly string[] =>
      this._registry.pathOf(resource, { supermarketId: context.id() }) ??
      this.listPath;

    return [
      {
        path: under('locations'),
        label: 'catalog.chains.tabs.shops',
        count: () => context.chain()?.locationCount ?? null,
      },
      {
        path: under('sections'),
        label: 'catalog.chains.tabs.sections',
        count: () => context.sectionCount(),
      },
      {
        path: under('price-scopes'),
        label: 'catalog.chains.tabs.scopes',
        count: () => context.scopeCount(),
      },
      {
        path: this.detailsPath(),
        label: 'catalog.chains.tabs.details',
      },
    ];
  });

  constructor() {
    const destroy = inject(DestroyRef);

    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(CHAIN_PARAM);
      if (id !== null && id !== this.chain.id()) {
        this.refusalKey.set(null);
        void this.chain.open(id);
      }
    });
    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.shopOpen.set(this._isShopOpen());
      }
    });
    destroy.onDestroy(() => {
      params.unsubscribe();
      events.unsubscribe();
    });

    // A shop was added or deleted, so the chain's count of them moved. The
    // chain is said to have changed, which the column of chains and the read
    // below both follow.
    let shops = this._changes.version('locations');
    effect(() => {
      const version = this._changes.version('locations');
      untracked(() => {
        if (version !== shops) {
          shops = version;
          this._changes.wrote('supermarkets');
        }
      });
    });

    // Anything the header or a tab's count shows was written: read it again.
    let seen = this._written();
    effect(() => {
      const version = this._written();
      untracked(() => {
        if (version !== seen) {
          seen = version;
          void this.chain.reload();
        }
      });
    });
  }

  async confirmDelete(): Promise<void> {
    this.removing.set(true);
    this.refusalKey.set(null);
    try {
      await this.chain.remove();
      this.deleting.set(false);
      await this._router.navigate([...this.listPath]);
    } catch (error) {
      this.deleting.set(false);
      this.refusalKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
    } finally {
      this.removing.set(false);
    }
  }

  /** The writes that change what this page shows, as one number. */
  private _written(): number {
    return (
      this._changes.version('supermarkets') +
      this._changes.version('sections') +
      this._changes.version('price-scopes')
    );
  }

  /** The chain's own address, through the registry and never typed. */
  private _path(): readonly string[] {
    const id = this.chain.id();
    return id === null
      ? this.listPath
      : (this._registry.rowPath('supermarkets', id) ?? this.listPath);
  }

  private _isShopOpen(): boolean {
    const tab = this._route.snapshot.firstChild;
    const shops = this._registry.byName('locations')?.segment;
    return tab != null && tab.url[0]?.path === shops && tab.firstChild !== null;
  }
}
