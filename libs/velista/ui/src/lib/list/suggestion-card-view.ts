import {
  catalogName,
  type CatalogItem,
  type CatalogSuggestion,
  type ChainPrice,
} from '@portfolio/velista/models';
import type {
  ProductRowGroup,
  ProductRowShop,
  ProductRowView,
} from '../catalog/product-row';
import {
  chainLine,
  priceAgeText,
  priceText,
  productRowView,
  type CatalogTranslate,
} from '../catalog/product-row-view';
import { productSizeText } from '../catalog/product-size';
import { matchedSynonym } from './matched-synonym';

/** A translator call, so this stays a plain function a spec can run. */
export type SuggestionTranslate = CatalogTranslate;

export interface SuggestionCardOptions {
  readonly locale: string;
  readonly translate: SuggestionTranslate;
  /** Now, for the age of a stale price. A parameter so a spec can fix it. */
  readonly now: Date;
  /**
   * The words these suggestions answer, for {@link SuggestionCardView.alsoCalled}.
   * Absent or null draws no synonym on any card.
   */
  readonly query?: string | null;
}

/**
 * What one search card says (velista `0101`, drawn as the one card since `0162`),
 * decided once, here.
 *
 * The card's own fields are {@link row}, built by {@link productRowView} as the
 * catalog's are, so the size text and the unit price rule have one home. The
 * search adds what only it knows: a group, every chain's price and the synonym
 * that matched.
 */
export interface SuggestionCardView {
  /** Stable across keystrokes for the same product, so an opened card stays open. */
  readonly key: string;
  readonly suggestion: CatalogSuggestion;
  readonly row: ProductRowView;
  /** The group's members and reveal, or null for a product. */
  readonly group: ProductRowGroup | null;
  /** Every chain's price, cheapest first. Empty for a group. */
  readonly shops: readonly ProductRowShop[];
  /**
   * "Also called: algodón" on a group that matched through one of its other
   * words and not its name, or null (velista `0108`, target 4). Always null on
   * an item, whose search document carries no synonyms since backend `0156`.
   */
  readonly alsoCalled: string | null;
  /** The product a press on the card opens, or null for a group. */
  readonly productId: string | null;
  /** The plus's accessible name: the product, its brand, its pack and its size. */
  readonly pickLabel: string;
}

export function suggestionCardView(
  suggestion: CatalogSuggestion,
  options: SuggestionCardOptions
): SuggestionCardView {
  return suggestion.kind === 'group'
    ? groupView(suggestion, options)
    : itemView(suggestion, suggestion.item, options);
}

function itemView(
  suggestion: CatalogSuggestion,
  item: CatalogItem,
  options: SuggestionCardOptions
): SuggestionCardView {
  const { locale, translate } = options;
  const chains = chainLine(
    item.chainPrices.map((row) => ({
      id: row.chain.id,
      name: catalogName(row.chain.name, locale),
    })),
    options
  );
  const row = productRowView(item, {
    locale,
    translate,
    now: options.now,
    chainChosen: false,
    chainOf: () => null,
    chains,
  });
  const pack =
    item.packCount === null
      ? null
      : translate('list.add.card.pack', { count: item.packCount });

  return {
    key: `item:${item.id}`,
    suggestion,
    row,
    group: null,
    shops:
      chains === null
        ? []
        : item.chainPrices.map((price, index) =>
            shopView(price, index, options)
          ),
    alsoCalled: null,
    productId: item.id,
    pickLabel: translate('list.add.card.add', {
      name:
        [
          row.name,
          item.brand,
          pack,
          productSizeText(item.size, item.unit, locale, translate),
        ]
          .filter((part): part is string => part !== null && part !== '')
          .join(', ') || row.name,
    }),
  };
}

function groupView(
  suggestion: Extract<CatalogSuggestion, { kind: 'group' }>,
  options: SuggestionCardOptions
): SuggestionCardView {
  const { locale, translate } = options;
  const name = catalogName(suggestion.group.name, locale);
  const count = suggestion.itemIds.length;
  const price = priceText(suggestion.offer, locale);
  const stale = price !== null && suggestion.offer?.stale === true;
  const members = suggestion.members.map((member) => ({
    id: member.id,
    name: catalogName(member.name, locale),
    brand: member.brand,
    price: priceText(member.offer, locale),
  }));
  const rest = count - members.length;
  const synonym =
    options.query === undefined || options.query === null
      ? null
      : matchedSynonym(
          suggestion.group.name,
          suggestion.synonyms,
          options.query,
          locale
        );
  const badge = translate('list.add.card.groupBadge');

  return {
    key: `group:${suggestion.group.id}`,
    suggestion,
    row: {
      id: `group-${suggestion.group.id}`,
      name,
      detail: count > 0 ? translate('list.add.groupAdds', { count }) : null,
      caption: null,
      imageUrl: null,
      // Labelled "from" by the card, because it is the cheapest of several and
      // not the price of a thing (rule 4).
      price,
      unitPrice: null,
      seen: stale ? priceAgeText(suggestion.offer, options.now, locale) : null,
      stale,
      chains: null,
      label: [
        name,
        badge,
        price === null
          ? null
          : `${translate('list.add.card.from')} ${price}`.trim(),
      ]
        .filter((part): part is string => part !== null)
        .join(', '),
      summary: null,
    },
    group: {
      members,
      reveal:
        members.length > 0
          ? translate('list.add.card.groupProducts', { count })
          : null,
      more:
        rest > 0 && members.length > 0
          ? translate('list.add.card.groupMore', { count: rest })
          : null,
    },
    shops: [],
    alsoCalled:
      synonym === null
        ? null
        : translate('list.add.card.alsoCalled', { synonym }),
    productId: null,
    pickLabel: translate('list.add.card.add', { name }),
  };
}

function shopView(
  row: ChainPrice,
  index: number,
  options: SuggestionCardOptions
): ProductRowShop {
  const seen = row.offer.stale
    ? priceAgeText(row.offer, options.now, options.locale)
    : null;
  return {
    id: row.chain.id,
    name: catalogName(row.chain.name, options.locale),
    price: priceText(row.offer, options.locale),
    note:
      seen === null
        ? null
        : options.translate('list.add.card.seen', { when: seen }),
    // The mapper sorted them, so the first is the cheapest whenever it has a price.
    best: index === 0 && row.offer.price !== null,
  };
}
