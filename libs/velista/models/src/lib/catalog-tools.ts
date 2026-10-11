/**
 * What the catalog's two selectors and the line that heads the list say (velista
 * `0134`, sections 2 and 3), decided once, here, from what the page already holds.
 *
 * Names arrive in the reader's language. The words around them ("All supermarkets",
 * "Prices at") are the template's, because this library has no translator.
 */
export interface CatalogToolsInput {
  /** The chosen chain's id, or null for every supermarket. */
  readonly chainId: string | null;
  /** The chosen chain's name, or blank while it is not known yet. */
  readonly chainName: string;
  readonly chainLogoUrl: string | null;
  /** The chosen category, or null. `root` is null when the root is the choice. */
  readonly category: {
    readonly name: string;
    readonly root: string | null;
  } | null;
  /** The person's first postal code, or null with none. */
  readonly postalCode: string | null;
}

/** The Supermarket selector. `chosen` false draws "All supermarkets". */
export interface SupermarketSelectorView {
  readonly chosen: boolean;
  /** The chain's name. Blank when nothing is chosen. */
  readonly name: string;
  readonly logoUrl: string | null;
}

/** The Category selector. `chosen` false draws "All categories". */
export interface CategorySelectorView {
  readonly chosen: boolean;
  /** The leaf alone, or the root when the root is the choice. */
  readonly name: string;
  /** The root of a chosen leaf, for the accessible name. Null for a root. */
  readonly root: string | null;
}

/**
 * The left end of the line that heads the list. Only one shows, in this order:
 * the chain, the postal code.
 */
export type CatalogHeadNote =
  | {
      readonly kind: 'chain';
      readonly chain: string;
      readonly postalCode: string | null;
    }
  | { readonly kind: 'near'; readonly postalCode: string };

export interface CatalogToolsView {
  readonly supermarket: SupermarketSelectorView;
  readonly category: CategorySelectorView;
  readonly note: CatalogHeadNote | null;
}

export function catalogToolsView(input: CatalogToolsInput): CatalogToolsView {
  const chainChosen = input.chainId !== null;

  return {
    supermarket: {
      chosen: chainChosen,
      name: chainChosen ? input.chainName : '',
      logoUrl: chainChosen ? input.chainLogoUrl : null,
    },
    category:
      input.category === null
        ? { chosen: false, name: '', root: null }
        : {
            chosen: true,
            name: input.category.name,
            root: input.category.root,
          },
    note: headNote(input),
  };
}

function headNote(input: CatalogToolsInput): CatalogHeadNote | null {
  if (input.chainId !== null && input.chainName !== '') {
    return {
      kind: 'chain',
      chain: input.chainName,
      postalCode: input.postalCode,
    };
  }
  return input.postalCode === null
    ? null
    : { kind: 'near', postalCode: input.postalCode };
}
