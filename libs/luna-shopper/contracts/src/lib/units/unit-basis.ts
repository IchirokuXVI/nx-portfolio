import type { UnitBasis } from '../messages/catalog.messages';

/**
 * What each verbatim unit price label means (plan 0157, section 1).
 *
 * Keyed on the label after lowercasing and trimming, and after a leading `€/`
 * is removed (plan 0264). **Nothing else is parsed**: a label this table does
 * not name reads as null, never as a guess. The label and the amount are stored
 * verbatim and stay that way, like `bulk_price` in CLAUDE.md. This only names
 * the basis, on read.
 *
 * Every key is a value found in a real catalog, and the plan's own rows are the
 * first four groups. `100 ml` and `100 g` are extensions the plan allows, from
 * the plan 0150 catalog: Mercadona's `reference_format` names the size it shows
 * on the shelf tag, and the amount beside it is per litre on 561 of its 615
 * rows and per kilo on 45 of its 57.
 *
 * Carrefour prints no label. Its adapter builds `€/kg`, `€/l` and `€/ud` from
 * the card's `measure_unit`, and the figure beside it is a price per that unit
 * on every priced card of its fixtures (`unit-basis-proof.spec.ts` in the
 * Carrefour library). So the reader removes the `€/` and finds `kg`, `l` and
 * `ud` here; `€/m` finds `m`, which stays null.
 *
 * Two labels are known to disagree with their amount at the source, and the
 * table maps them anyway, because correcting a chain's number is exactly what
 * this must not do: `dz` and `dc` sit on a price per egg.
 *
 * **A wash is no basis** (plan 0264, D2). A wash count is the brand's own
 * claim: nobody can measure it, and it is a bad basis to compare prices on. So
 * `lv`, `lavado`, `lavados` and `€/lavado` stay null, and no wash key is added
 * in any spelling.
 *
 * `m` (metres of foil or film) and the blank label stay null: there is no
 * basis for a metre, and a blank label names nothing.
 *
 * It lives here, and not in catalog, because the harvester reads the same
 * table for the prices its queue shows (plan 0189). The table itself is as
 * plan 0157 wrote it. Browser reachable: it names no `process`.
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
};

/** The `€/` a label built from a unit opens with, spaces around the slash allowed. */
const EURO_PER = /^€\s*\/\s*/;

/** The basis a verbatim label names, or null when the table does not know it. */
export function unitBasisOf(
  label: string | null | undefined
): UnitBasis | null {
  if (label === null || label === undefined) {
    return null;
  }
  // An own property test rather than a bare index, so a label such as
  // `constructor` reads as unknown and not as a function off the prototype.
  const key = label.trim().toLowerCase().replace(EURO_PER, '');
  return Object.prototype.hasOwnProperty.call(UNIT_BASIS_BY_LABEL, key)
    ? UNIT_BASIS_BY_LABEL[key]
    : null;
}
