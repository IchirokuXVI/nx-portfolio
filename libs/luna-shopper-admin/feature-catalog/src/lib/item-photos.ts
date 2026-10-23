import type { Wire } from '@portfolio/luna-shopper-admin/models';

/** The photo fields of a product view, which catalog works out together. */
type ItemPhotoFields = Pick<
  Wire.CatalogItemView,
  'imageUrl' | 'imageSource' | 'imageSupermarketId' | 'ownImageUrl' | 'images'
>;

/**
 * The photos a product answers, as catalog works them out (backend plan
 * 0198, section 3.1), for the memory back end.
 *
 * `images` is our photo first when there is one, then the photo of each link
 * whose chain is on, in the order the links are held. `imageUrl` and its
 * source are the first entry. `ownImageUrl` is ours alone, which is what the
 * back office edits. A link of a chain that is off is in no field.
 */
export function itemPhotos(
  ownImageUrl: string | null,
  links: readonly Wire.CatalogItemLinkedImageView[]
): ItemPhotoFields {
  const own = ownImageUrl === null || ownImageUrl === '' ? null : ownImageUrl;
  const images: Wire.CatalogItemImageView[] = [
    ...(own === null
      ? []
      : [{ url: own, source: 'OWNER' as const, supermarketId: null }]),
    ...links
      .filter((link) => link.enabled)
      // One entry for an address that two rows state.
      .filter(
        (link, index, all) =>
          all.findIndex((other) => other.url === link.url) === index
      )
      .map((link) => ({
        url: link.url,
        source: 'CHAIN' as const,
        supermarketId: link.supermarketId,
      })),
  ];
  const first = images[0] ?? null;

  return {
    imageUrl: first?.url ?? null,
    imageSource: first?.source ?? null,
    imageSupermarketId: first?.supermarketId ?? null,
    ownImageUrl: own,
    images,
  };
}
