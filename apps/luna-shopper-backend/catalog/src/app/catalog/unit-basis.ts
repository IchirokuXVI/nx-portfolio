import type { UnitBasis } from '@portfolio/luna-shopper/contracts';

/**
 * What each verbatim unit price label means (plan 0157, section 1).
 *
 * Keyed on the label after lowercasing and trimming, and **nothing else is
 * parsed**: a label this table does not name reads as null, never as a guess.
 * The label and the amount are stored verbatim and stay that way, like
 * `bulk_price` in CLAUDE.md. This only names the basis, on read.
 *
 * Every key is a value found in a real catalog, and the plan's own rows are the
 * first five groups. `100 ml` and `100 g` are extensions the plan allows, from
 * the plan 0150 catalog: Mercadona's `reference_format` names the size it shows
 * on the shelf tag, and the amount beside it is per litre on 561 of its 615
 * rows and per kilo on 45 of its 57.
 *
 * Two labels are known to disagree with their amount at the source, and the
 * table maps them anyway, because correcting a chain's number is exactly what
 * this must not do: `dz` and `dc` sit on a price per egg, and `lv` on liquid
 * detergent sits on a price per litre.
 *
 * `m` (metres of foil or film) and the blank label stay null: there is no
 * basis for a metre, and a blank label names nothing.
 */
const UNIT_BASIS_BY_LABEL: Readonly<Record<string, UnitBasis>> = {
  kg: 'KILOGRAM',
  kilo: 'KILOGRAM',
  'el kilo le sale a': 'KILOGRAM',
  '100 g': 'KILOGRAM',
  l: 'LITER',
  litro: 'LITER',
  'el litro le sale a': 'LITER',
  '100 ml': 'LITER',
  ud: 'UNIT',
  unidad: 'UNIT',
  dz: 'DOZEN',
  dc: 'DOZEN',
  docena: 'DOZEN',
  lv: 'WASH',
  lavado: 'WASH',
};

/** The basis a verbatim label names, or null when the table does not know it. */
export function unitBasisOf(
  label: string | null | undefined
): UnitBasis | null {
  if (label === null || label === undefined) {
    return null;
  }
  // An own property test rather than a bare index, so a label such as
  // `constructor` reads as unknown and not as a function off the prototype.
  const key = label.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_BASIS_BY_LABEL, key)
    ? UNIT_BASIS_BY_LABEL[key]
    : null;
}
