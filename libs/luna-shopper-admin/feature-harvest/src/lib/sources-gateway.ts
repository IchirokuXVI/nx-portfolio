import { inject, Injectable, signal } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import type {
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { ChainNames } from './chain-names';
import { HarvestShell } from './harvest-shell';

/**
 * An adapter a source may be written with.
 *
 * Narrower than the view's `EnumsAdapterKey`, which still lists `osm-places`
 * because rows written before backend plan 0153 hold it. OpenStreetMap is
 * asked for every postal code and has no row to switch it on, so the upsert
 * refuses the key (admin plan 0034, section 4).
 */
export type SourceAdapterKey = Wire.UpsertSupermarketSourceDto['adapterKey'];

/**
 * The adapters `UpsertSupermarketSourceDto` accepts, in the order the picker
 * offers them.
 *
 * It is a `Record` keyed on the wire union and not an array of strings, so
 * that a key the document declares and this file does not is a compile error
 * here. The array form drifted twice: `lidl-api` (backend plan 0089) and
 * `carrefour-web` (backend plan 0090) both reached the contract, the gateway
 * and the generated types while the list still named four adapters, so two
 * chains shipped with a runner nobody could describe a source for.
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

export const SOURCE_ADAPTERS: readonly SourceAdapterKey[] = (
  Object.keys(ADAPTER_ORDER) as SourceAdapterKey[]
).sort((a, b) => ADAPTER_ORDER[a] - ADAPTER_ORDER[b]);

/** Whether a row's adapter is one a row may still be written with. */
export function isWritableAdapter(key: unknown): key is SourceAdapterKey {
  return typeof key === 'string' && key in ADAPTER_ORDER;
}

/**
 * One chain source, as the screens read it: the view of the harvester, and
 * what its chain is called.
 *
 * The view carries the ID of the chain alone, because a chain's name belongs
 * to catalog. `chainName` is `null` for a chain the lookup could not name,
 * and the descriptor then heads the record by its adapter.
 */
export type Source = Wire.HarvestSupermarketSourceView & {
  chainName: string | null;
};

/**
 * The chain sources, as a resource (admin plan 0059, section 2).
 *
 * A hand written {@link ResourceGateway}, because a source has no routes of
 * the shape `ResourceSource` reads. It is keyed on the ID of its chain, one
 * route both adds and changes it, and whether it may be fetched has a route
 * of its own. **Every call here is one `HARVEST_SERVICE` already made** for
 * the screen this replaced: this file adds no request.
 *
 * At root, and singly, so that the Sources tab and the list inside it look at
 * the same instance: the tab draws the notice of the harvester when the read
 * of the list was the one that failed.
 */
@Injectable({ providedIn: 'root' })
export class SourcesGateway implements ResourceGateway<Source> {
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _names = inject(ChainNames);
  private readonly _shell = inject(HarvestShell);
  private readonly _translator = inject(RokuTranslatorService);

  private readonly _listFailed = signal(false);

  /** Whether the last read of the first page of the list failed. */
  readonly listFailed = this._listFailed.asReadonly();

  /** Forget that failure, so that the list is read again. */
  retryList(): void {
    this._listFailed.set(false);
  }

  async list(query: ResourceQuery): Promise<ResourcePage<Source>> {
    let page: Wire.HarvestSupermarketSourcePage;
    try {
      page = await this._harvest.listSources({
        cursor: query.cursor,
        limit: query.limit,
      });
    } catch (error) {
      this._shell.observeFailure();
      // A further page that failed leaves the rows that were read on the
      // screen, and the list says so itself.
      if (query.cursor === undefined) {
        this._listFailed.set(true);
      }
      throw error;
    }

    this._shell.observeReachable();
    this._listFailed.set(false);

    await this._resolve(page.items.map((row) => row.supermarketId));
    return {
      items: page.items.map((row) => this._named(row)),
      nextCursor: page.nextCursor,
    };
  }

  /** One source, by the ID of its chain. */
  async read(id: string): Promise<Source> {
    const view = await this._harvest.readSource(id);
    await this._resolve([view.supermarketId]);
    return this._named(view);
  }

  /**
   * Describe a chain that has no source yet.
   *
   * **A create never overwrites.** The route is an upsert, so a create for a
   * chain that has a source would rewrite a configuration nobody was looking
   * at. The source of the chain is read first, and one that exists is a
   * refusal the form draws under the chain.
   *
   * The source is created with fetching off, by the backend and on purpose:
   * to describe a chain and to start fetching it are two decisions, and the
   * second is the named action of the descriptor.
   */
  async create(input: ResourceInput): Promise<Source> {
    const chainId = String(input['supermarketId'] ?? '');

    if (await this._exists(chainId)) {
      throw this._refusal('supermarketId', 'harvest.sources.exists');
    }

    return this._write(chainId, this._body(input, null));
  }

  /**
   * Change a source.
   *
   * The form sends only what changed and the route takes the whole source, so
   * the source is read as it is now and the changed fields go over it.
   */
  async update(id: string, input: ResourceInput): Promise<Source> {
    const current = await this._harvest.readSource(id);
    return this._write(id, this._body(input, current));
  }

  async remove(id: string): Promise<void> {
    await this._harvest.deleteSource(id);
  }

  /**
   * Say whether a chain may be fetched.
   *
   * Its own route, because to describe a chain and to fetch it are two
   * decisions. The named actions of the descriptor call this, and nothing
   * else changes `enabled`.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this._harvest.setSourceEnabled(id, enabled);
  }

  /**
   * The body of the upsert: what the form sent, over the source as it is.
   *
   * Each property is named. `enabled` is not among them, so no save can turn
   * fetching on or off, whatever a caller put in the input.
   */
  private _body(
    input: ResourceInput,
    current: Wire.HarvestSupermarketSourceView | null
  ): Wire.UpsertSupermarketSourceDto {
    const adapterKey = input['adapterKey'] ?? current?.adapterKey;
    // A row that still names `osm-places` cannot go back as it is: the
    // server refuses the key. Said under the field, where the fix is.
    if (!isWritableAdapter(adapterKey)) {
      throw this._refusal('adapterKey', 'harvest.sources.adapterGone');
    }

    const workers = input['workers'] ?? current?.workers;
    const rate = input['maxRequestsPerSecond'] ?? current?.maxRequestsPerSecond;
    const config = input['config'] ?? current?.config;
    const trusted = input['autoImportPlaces'] ?? current?.autoImportPlaces;

    return {
      adapterKey,
      ...(typeof workers === 'number' ? { workers } : {}),
      ...(typeof rate === 'number' ? { maxRequestsPerSecond: rate } : {}),
      ...(isSettings(config) ? { config } : {}),
      ...(typeof trusted === 'boolean' ? { autoImportPlaces: trusted } : {}),
    };
  }

  private async _write(
    chainId: string,
    body: Wire.UpsertSupermarketSourceDto
  ): Promise<Source> {
    const view = await this._harvest.upsertSource(chainId, body);
    await this._resolve([view.supermarketId]);
    return this._named(view);
  }

  /** Whether the chain has a source. Any failure but "not found" is thrown. */
  private async _exists(chainId: string): Promise<boolean> {
    try {
      await this._harvest.readSource(chainId);
      return true;
    } catch (error) {
      const failure = toGatewayError(error);
      if (failure.code === 'not_found' || failure.status === 404) {
        return false;
      }
      throw failure;
    }
  }

  /**
   * A refusal about one field, in the shape the server refuses a field with.
   *
   * The sentence is translated here, at the moment it is thrown, as the
   * server translates its own. No request was made, so there is no status.
   */
  private _refusal(field: string, key: string): GatewayError {
    return new GatewayError({
      code: 'validation_failed',
      status: 422,
      correlationId: '',
      fieldErrors: { [field]: [this._translator.t(key)] },
    });
  }

  /**
   * Name the chains not named yet. A lookup that fails costs a name and not
   * the read: the record is then headed by its adapter.
   */
  private async _resolve(ids: readonly string[]): Promise<void> {
    try {
      await this._names.resolve(ids);
    } catch {
      // Nothing to do. `_named` answers `null` for a chain with no name.
    }
  }

  private _named(view: Wire.HarvestSupermarketSourceView): Source {
    return { ...view, chainName: this._names.known(view.supermarketId) };
  }
}

/** Whether a value is the object the `config` column holds. */
function isSettings(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
