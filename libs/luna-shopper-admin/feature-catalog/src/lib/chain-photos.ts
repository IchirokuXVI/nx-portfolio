import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  ApiUrl,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceChanges } from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ActionOutcome,
  NamedAction,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom, type Observable } from 'rxjs';
import { seededLinks } from './catalog-seed';
import {
  itemSource,
  SUPERMARKETS_PATH,
  supermarketSource,
} from './catalog-sources';
import { itemPhotos } from './item-photos';
import type { Supermarket } from './supermarkets';

/**
 * Where the photos of every chain are hidden in one write (backend plan 0198,
 * section 4). A command and not a collection: it answers two counts.
 */
const DISABLE_ALL_PATH = '/v1/admin/catalog/linked-images/disable-all';

/** Where the photos of one chain are shown or hidden. */
function linkedImagesPath(chainId: string): string {
  return `${SUPERMARKETS_PATH}/${encodeURIComponent(chainId)}/linked-images`;
}

/** What the stop for every chain changed. */
export interface PhotosHidden {
  readonly supermarkets: number;
  readonly items: number;
}

/**
 * Shows or hides the photos a chain gives for its products (admin plan 0066).
 *
 * Shaped like `ProductGroupAssignments`: over HTTP when the app bound the
 * gateways, and against the memory tables otherwise, so the page works with
 * nothing listening.
 *
 * **Every write says that chains and products changed.** A chain's row holds
 * the switch, and what a product shows as its photo follows it in the same
 * transaction, so a product page that is open reads again.
 */
@Injectable({ providedIn: 'root' })
export class ChainPhotos {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });
  private readonly _changes = inject(ResourceChanges);

  /** Turn the photos of one chain on or off. */
  async set(chainId: string, enabled: boolean): Promise<void> {
    const memory = this._memory();
    if (memory !== null) {
      await setInMemory(memory, chainId, enabled);
    } else {
      // A JSON boolean: the gateway refuses `"true"` on purpose.
      const body: Wire.SetLinkedImagesEnabledDto = { enabled };
      await this._send((http, urls) =>
        http.put<unknown>(urls.gateway(linkedImagesPath(chainId)), body)
      );
    }
    this._wrote();
  }

  /** Turn the photos of every chain off, and say how much that changed. */
  async hideAll(): Promise<PhotosHidden> {
    const memory = this._memory();
    const answer =
      memory !== null
        ? await hideAllInMemory(memory)
        : toPhotosHidden(
            await this._send((http, urls) =>
              http.post<unknown>(urls.gateway(DISABLE_ALL_PATH), null)
            )
          );
    this._wrote();
    return answer;
  }

  private _wrote(): void {
    this._changes.wrote('supermarkets');
    this._changes.wrote('items');
  }

  private _memory(): ResourceMemoryGateways | null {
    const gateways = this._gateways;
    return gateways instanceof ResourceMemoryGateways ? gateways : null;
  }

  private async _send(
    request: (http: HttpClient, urls: ApiUrl) => Observable<unknown>
  ): Promise<unknown> {
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'ChainPhotos needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }
    try {
      return await firstValueFrom(request(http, urls));
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

/**
 * The stop's answer, read from `unknown` (rule D4). A count the answer does
 * not hold reads as 0, which never claims a change that did not happen.
 */
export function toPhotosHidden(answer: unknown): PhotosHidden {
  const record =
    typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>)
      : {};
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value
      : 0;
  return {
    supermarkets: count(record['supermarkets']),
    items: count(record['items']),
  };
}

/**
 * One chain's switch in memory. Its saved links (the seed's) follow the
 * switch, so turning it on shows them again and turning it off takes its
 * photos out of every product, as catalog does.
 */
async function setInMemory(
  memory: ResourceMemoryGateways,
  chainId: string,
  enabled: boolean
): Promise<void> {
  // Throws the not found the gateway answers for a chain that is not there.
  await memory
    .for(supermarketSource())
    .update(chainId, { linkedImagesEnabled: enabled });
  refreshChainImages(memory, (supermarketId) => supermarketId === chainId);
}

/** The stop in memory: every chain off, and every chain photo gone. */
async function hideAllInMemory(
  memory: ResourceMemoryGateways
): Promise<PhotosHidden> {
  const chains = memory.for(supermarketSource());
  const on = memory
    .tables()
    .table(supermarketSource())
    .filter((chain) => chain.linkedImagesEnabled)
    .map((chain) => chain.id);
  for (const id of on) {
    await chains.update(id, { linkedImagesEnabled: false });
  }
  return {
    supermarkets: on.length,
    items: refreshChainImages(memory, () => true),
  };
}

/**
 * Work out again the photos of every product that a link or a photo of a
 * chain `touched` names, from our photo and its links as the chain table now
 * switches them. Answers how many products changed.
 *
 * Straight into the table, and not through the item gateway: its update rule
 * reads `imageUrl` as a write of our photo, and the photo shown here may be a
 * chain's.
 */
function refreshChainImages(
  memory: ResourceMemoryGateways,
  touched: (supermarketId: string | null) => boolean
): number {
  const chains = memory.tables().table(supermarketSource());
  const rows = memory.tables().table(itemSource()) as Wire.CatalogItemView[];
  let changed = 0;
  // In place, so that a table that is iterating its rows finds each one
  // where it was.
  for (const [index, item] of rows.entries()) {
    const links = seededLinks(item.id, chains);
    const affected =
      links.some((link) => touched(link.supermarketId)) ||
      (item.images ?? []).some(
        (image) => image.source === 'CHAIN' && touched(image.supermarketId)
      );
    if (!affected) {
      continue;
    }
    const photos = itemPhotos(item.ownImageUrl ?? null, links);
    if (JSON.stringify(photos.images) === JSON.stringify(item.images ?? [])) {
      continue;
    }
    rows[index] = { ...item, ...photos };
    changed += 1;
  }
  return changed;
}

/**
 * The line the page draws after the stop: "Photos hidden for 2 chains and
 * 3,104 products." Two counts with a plural each, so each count is a phrase
 * of its own, and the numbers are formatted for the reader's language.
 */
export function photosHiddenLine(
  hidden: PhotosHidden,
  translator: RokuTranslatorService
): ActionOutcome {
  const locale = translator.locale();
  const phrase = (key: string, count: number) =>
    translator.t(key, undefined, undefined, {
      count,
      n: new Intl.NumberFormat(locale).format(count),
    });
  return {
    kind: 'line',
    key: 'catalog.supermarkets.photosHidden.line',
    args: {
      chains: phrase(
        'catalog.supermarkets.photosHidden.chains',
        hidden.supermarkets
      ),
      products: phrase(
        'catalog.supermarkets.photosHidden.products',
        hidden.items
      ),
    },
  };
}

/**
 * The three named actions of a chain's photos (admin plan 0066, targets 2
 * to 4).
 *
 * The two of one chain are plain: each is taken back by the other with one
 * press. The stop for every chain is `danger`, because one press cannot take
 * it back: each chain must be shown again by itself. It is on the page of a
 * chain only, since its answer is a line that a list has nowhere to put.
 *
 * The stop is offered on every chain. Whether some chain is on is a read of
 * every chain, and the page of one chain does not make it.
 */
export function chainPhotoActions(
  photos: ChainPhotos,
  translator: RokuTranslatorService
): readonly NamedAction<Supermarket>[] {
  return [
    {
      name: 'show-photos',
      label: 'catalog.supermarkets.action.showPhotos',
      available: (row) => row.linkedImagesEnabled !== true,
      confirm: {
        heading: 'catalog.supermarkets.confirm.showPhotos.heading',
        body: 'catalog.supermarkets.confirm.showPhotos.body',
        confirm: 'catalog.supermarkets.confirm.showPhotos.confirm',
      },
      run: (row) => photos.set(row.id, true),
    },
    {
      name: 'hide-photos',
      label: 'catalog.supermarkets.action.hidePhotos',
      available: (row) => row.linkedImagesEnabled === true,
      confirm: {
        heading: 'catalog.supermarkets.confirm.hidePhotos.heading',
        body: 'catalog.supermarkets.confirm.hidePhotos.body',
        confirm: 'catalog.supermarkets.confirm.hidePhotos.confirm',
      },
      run: (row) => photos.set(row.id, false),
    },
    {
      name: 'hide-every-chain-photos',
      label: 'catalog.supermarkets.action.hideAllPhotos',
      danger: true,
      recordOnly: true,
      confirm: {
        heading: 'catalog.supermarkets.confirm.hideAllPhotos.heading',
        body: 'catalog.supermarkets.confirm.hideAllPhotos.body',
        confirm: 'catalog.supermarkets.confirm.hideAllPhotos.confirm',
      },
      run: async () => photosHiddenLine(await photos.hideAll(), translator),
    },
  ];
}
