/**
 * The browser reachable entry of the line unit rules (plan 0246, sections 1
 * and 2), mapped as `@portfolio/luna-shopper/contracts/line-units`.
 *
 * `basket-rules` runs in velista too, and the main barrel of the contracts
 * library compiles ajv and every schema into whoever imports it. This entry
 * reaches only the two pure files and what they import: `catalog.enums` and
 * `source-size`, which name no ajv and no `process`.
 *
 * The main barrel still exports both files, so the backend imports them as
 * before.
 */
export * from './line-amount';
export * from './line-unit';
