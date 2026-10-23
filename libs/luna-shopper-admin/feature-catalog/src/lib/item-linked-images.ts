import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiUrl,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { firstValueFrom } from 'rxjs';
import { seededLinks } from './catalog-seed';
import { ITEMS_PATH, supermarketSource } from './catalog-sources';

/** The chain photo saved for one source row, as the Sources tab draws it. */
export interface ItemSourcePhoto {
  readonly url: string;
  /** Whether the chain's photos are on, so a shopper can be shown this one. */
  readonly enabled: boolean;
}

/**
 * The links of a product off the wire, by the source row each is keyed on
 * (rule D4). An entry with no row or no address cannot be drawn and is left
 * out. An answer that is not the shape answers no photo at all.
 */
export function toItemSourcePhotos(
  value: unknown
): ReadonlyMap<string, ItemSourcePhoto> {
  const photos = new Map<string, ItemSourcePhoto>();
  const images =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)['images']
      : undefined;
  if (!Array.isArray(images)) {
    return photos;
  }
  for (const image of images) {
    if (typeof image !== 'object' || image === null) {
      continue;
    }
    const link = image as Record<string, unknown>;
    const entry = link['sourceEntryId'];
    const url = link['url'];
    if (
      typeof entry !== 'string' ||
      entry === '' ||
      typeof url !== 'string' ||
      url === '' ||
      photos.has(entry)
    ) {
      continue;
    }
    photos.set(entry, { url, enabled: link['enabled'] === true });
  }
  return photos;
}

/**
 * Every chain photo saved for a product, on or off
 * (`GET /v1/admin/catalog/items/{id}/linked-images`, backend plan 0198,
 * section 3.2). It is the one read that answers the photo of a chain that is
 * off, so a person can see what is saved before the chain is turned on.
 *
 * Over HTTP when the app bound the gateways to it, and from the seed of the
 * memory back end otherwise, as `ProductGroupAssignments` is.
 */
@Injectable({ providedIn: 'root' })
export class ItemLinkedImages {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });

  async read(itemId: string): Promise<ReadonlyMap<string, ItemSourcePhoto>> {
    if (this._gateways instanceof ResourceMemoryGateways) {
      // Each shown or not as its chain is switched now.
      const chains = this._gateways.tables().table(supermarketSource());
      return toItemSourcePhotos({ images: seededLinks(itemId, chains) });
    }
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'ItemLinkedImages needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }

    let answer: unknown;
    try {
      answer = await firstValueFrom(
        http.get<unknown>(
          urls.gateway(
            `${ITEMS_PATH}/${encodeURIComponent(itemId)}/linked-images`
          )
        )
      );
    } catch (error) {
      throw toGatewayError(error);
    }
    return toItemSourcePhotos(answer);
  }
}
