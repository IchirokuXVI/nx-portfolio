import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceChanges } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type ScopeLevel,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { priceScopeMark } from '../catalog-enums';
import { priceScopeSource } from '../catalog-sources';
import { SUPERMARKETS_PATH } from '../supermarkets';
import { SUPERMARKET_SEED } from '../supermarkets-seed';

/** The kinds of scope a chain has a handful of, widest first. */
const GENERAL_KINDS = ['NATIONAL', 'REGION', 'LOCAL_AREA'] as const;

/** How many rows one read asks for. The gateway's own maximum. */
const PAGE_SIZE = 100;

/**
 * How many pages a list is read to. Five hundred scopes is every general
 * scope of the largest chain. Past it the picker says the list is not whole.
 */
const MAX_PAGES = 5;

/** A chain, as much of it as naming a scope needs. */
export type ScopeChain = Pick<
  Wire.CatalogSupermarketView,
  'id' | 'name' | 'defaultPriceScopeId'
>;

/** A price scope, as much of it as naming one needs. */
export type ScopeRow = Pick<
  Wire.CatalogPriceScopeView,
  'id' | 'supermarketId' | 'kind' | 'externalKey' | 'label'
>;

/** One price scope and the chain it belongs to: what a picker chooses. */
export interface PriceScopeChoice {
  readonly chain: ScopeChain;
  readonly scope: ScopeRow;
}

/** The scopes of one chain, as far as they were read. */
export interface ChainScopes {
  /** `null` while the general scopes are being read. */
  readonly general: readonly ScopeRow[] | null;
  /** `null` until the single shop scopes are asked for. */
  readonly shops: readonly ScopeRow[] | null;
  readonly readingShops: boolean;
  /** Whether either list has more than was read. */
  readonly truncated: boolean;
  /**
   * Whether the last read of the general scopes failed. The list is then
   * empty for the picker to say so, and the next ask reads again.
   */
  readonly generalFailed: boolean;
  /** The same, for the single shop scopes. */
  readonly shopsFailed: boolean;
}

const UNREAD: ChainScopes = {
  general: null,
  shops: null,
  readingShops: false,
  truncated: false,
  generalFailed: false,
  shopsFailed: false,
};

/** The resources whose writes change what a picker offers. */
const WATCHED = ['supermarkets', 'price-scopes'] as const;

/**
 * What a price scope is called: its label, else its kind and the key its
 * source gave it, which is what the Price scopes tab of a chain says for one
 * with no label.
 */
export function scopeName(
  scope: Pick<ScopeRow, 'kind' | 'externalKey' | 'label'>,
  locales: readonly string[],
  kindLabel: string
): string {
  const label =
    scope.label === null || scope.label === undefined
      ? ''
      : localizedTextValue(scope.label, locales);
  if (label !== '') {
    return label;
  }
  return scope.externalKey === null || scope.externalKey === ''
    ? kindLabel
    : `${kindLabel} ${scope.externalKey}`;
}

/** How far a scope reaches, 1 the widest, or `null` for an unknown kind. */
export function scopeLevel(kind: unknown): ScopeLevel | null {
  return priceScopeMark(kind)?.level ?? null;
}

/**
 * The chains and their price scopes, read once for every picker (admin plan
 * 0043).
 *
 * The product list and the price form both choose a scope by its chain, and
 * the Prices tab of a product names the chain of each scope. One copy of the
 * chains serves all three, and the rows are kept as the gateway gave them:
 * a name is worked out where it is drawn, in the language the operator reads,
 * so a switch of that language needs nothing cleared here.
 *
 * A chain's single shop scopes are one for every shop, so they are read only
 * when asked for.
 *
 * **A write forgets all of it.** The service lives as long as the tab, so a
 * chain renamed or a scope added in this app would otherwise be missing from
 * every picker until a reload. `ResourceChanges` counts the writes to both
 * resources, and a change of either count empties what was read. A failed
 * read is never kept either: it is drawn as an empty list, and the next ask
 * reads again.
 */
@Injectable({ providedIn: 'root' })
export class ScopeChoices {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _changes = inject(ResourceChanges);

  private readonly _chains = signal<readonly ScopeChain[] | null>(null);
  private readonly _chainsFailed = signal(false);
  private readonly _scopes = signal<Readonly<Record<string, ChainScopes>>>({});
  private _readingChains: Promise<void> | null = null;
  /** Grows on every {@link forget}, so a read from before one is dropped. */
  private _epoch = 0;

  /** Every chain, or `null` until they are read. */
  readonly chains = this._chains.asReadonly();
  /** Whether the last read of the chains failed. They are then still `null`. */
  readonly chainsFailed = this._chainsFailed.asReadonly();

  /** The chains by id, for a screen that names the chain of a row. */
  readonly chainsById = computed(
    () => new Map((this._chains() ?? []).map((chain) => [chain.id, chain]))
  );

  constructor() {
    let seen = this._written();
    effect(() => {
      const written = this._written();
      if (written !== seen) {
        seen = written;
        this.forget();
      }
    });
  }

  /** Read the chains, once. A failed read is tried again the next time. */
  loadChains(): Promise<void> {
    if (this._chains() !== null) {
      return Promise.resolve();
    }
    if (this._readingChains === null) {
      const reading: Promise<void> = this._readChains().finally(() => {
        if (this._readingChains === reading) {
          this._readingChains = null;
        }
      });
      this._readingChains = reading;
    }
    return this._readingChains;
  }

  /** The scopes of a chain, as far as they were read. */
  scopesOf(chainId: string): ChainScopes {
    return this._scopes()[chainId] ?? UNREAD;
  }

  /** Read a chain's general scopes, once. */
  async loadScopes(chainId: string): Promise<void> {
    const held = this._scopes()[chainId];
    if (held !== undefined && !held.generalFailed) {
      return;
    }
    // Unread again while it is asked for, so a second ask waits for this one.
    this._patch(chainId, { general: null, generalFailed: false });
    const epoch = this._epoch;

    try {
      const read = await this._readScopes(chainId, [...GENERAL_KINDS]);
      if (epoch === this._epoch) {
        this._patch(chainId, {
          general: read.rows,
          truncated: read.truncated,
        });
      }
    } catch {
      // An empty list, which the picker says in words, and marked as failed:
      // the next press on the chain reads again.
      if (epoch === this._epoch) {
        this._patch(chainId, { general: [], generalFailed: true });
      }
    }
  }

  /** Read a chain's single shop scopes, once. */
  async loadShopScopes(chainId: string): Promise<void> {
    const held = this.scopesOf(chainId);
    if ((held.shops !== null && !held.shopsFailed) || held.readingShops) {
      return;
    }
    this._patch(chainId, { readingShops: true, shopsFailed: false });
    const epoch = this._epoch;

    try {
      const read = await this._readScopes(chainId, ['STORE']);
      if (epoch === this._epoch) {
        this._patch(chainId, {
          shops: read.rows,
          readingShops: false,
          truncated: this.scopesOf(chainId).truncated || read.truncated,
        });
      }
    } catch {
      if (epoch === this._epoch) {
        this._patch(chainId, {
          shops: [],
          readingShops: false,
          shopsFailed: true,
        });
      }
    }
  }

  /**
   * Forget what was read, so that the next picker reads again. A read that
   * is still on its way is not kept when it answers: it was asked before the
   * write that made this necessary.
   */
  forget(): void {
    this._epoch += 1;
    this._readingChains = null;
    this._chains.set(null);
    this._scopes.set({});
  }

  /** How many writes the watched resources have seen, together. */
  private _written(): number {
    return WATCHED.reduce(
      (sum, resource) => sum + this._changes.version(resource),
      0
    );
  }

  private async _readChains(): Promise<void> {
    this._chainsFailed.set(false);
    // The same table the chains' own descriptor reads.
    const gateway = this._gateways.for<Wire.CatalogSupermarketView>({
      path: SUPERMARKETS_PATH,
      seed: SUPERMARKET_SEED,
    });
    const rows: ScopeChain[] = [];
    let cursor: string | undefined;
    const epoch = this._epoch;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await gateway.list({ cursor, limit: PAGE_SIZE });
        rows.push(...answer.items);
        if (answer.nextCursor === null) {
          break;
        }
        cursor = answer.nextCursor;
      }
      if (epoch === this._epoch) {
        this._chains.set(rows);
      }
    } catch {
      // The chains stay unread, so the next picker that opens reads again.
      if (epoch === this._epoch) {
        this._chainsFailed.set(true);
      }
    }
  }

  private async _readScopes(
    chainId: string,
    kinds: readonly string[]
  ): Promise<{ rows: ScopeRow[]; truncated: boolean }> {
    const gateway = this._gateways.for(priceScopeSource());
    const rows: ScopeRow[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await gateway.list({
        cursor,
        limit: PAGE_SIZE,
        filters: { supermarketId: chainId, kind: kinds },
      });
      rows.push(...answer.items);
      if (answer.nextCursor === null) {
        return { rows, truncated: false };
      }
      cursor = answer.nextCursor;
    }

    return { rows, truncated: true };
  }

  private _patch(chainId: string, change: Partial<ChainScopes>): void {
    this._scopes.update((held) => ({
      ...held,
      [chainId]: { ...(held[chainId] ?? UNREAD), ...change },
    }));
  }
}

/** The one key the product list writes, namespaced as the other stores' are. */
const PRICES_AT_KEY = 'luna-shopper-admin.prices-at';

/**
 * The price scope the product list shows prices at, kept for the operator
 * (admin plan 0043, target 2).
 *
 * In `localStorage`, beside the content language and for the same reason: an
 * operator who works one chain for a week should not choose it on every visit.
 * The scope and its chain are stored as the gateway gave them, so the button
 * can name the choice before anything is read. Every access is wrapped,
 * because reading storage throws in a private window.
 */
@Injectable({ providedIn: 'root' })
export class PricesAtStore {
  private readonly _choice = signal<PriceScopeChoice | null>(stored());

  readonly choice = this._choice.asReadonly();

  choose(choice: PriceScopeChoice | null): void {
    this._choice.set(choice);
    try {
      if (choice === null) {
        globalThis.localStorage?.removeItem(PRICES_AT_KEY);
      } else {
        globalThis.localStorage?.setItem(PRICES_AT_KEY, JSON.stringify(choice));
      }
    } catch {
      // Storage refused. The choice still holds for this page.
    }
  }
}

/**
 * The stored choice, or `null`.
 *
 * Checked and not trusted: it was written by an older build or by hand, and a
 * value without the two ids would send the list a scope that is not one.
 */
function stored(): PriceScopeChoice | null {
  try {
    const raw = globalThis.localStorage?.getItem(PRICES_AT_KEY) ?? null;
    if (raw === null) {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    return isChoice(value) ? value : null;
  } catch {
    return null;
  }
}

function isChoice(value: unknown): value is PriceScopeChoice {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { chain, scope } = value as Record<string, unknown>;
  return (
    isRecord(chain) &&
    isRecord(scope) &&
    typeof chain['id'] === 'string' &&
    chain['id'] !== '' &&
    typeof scope['id'] === 'string' &&
    scope['id'] !== '' &&
    typeof scope['kind'] === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
