/**
 * A brand's key: its text with everything but letters and digits taken out
 * (plan 0115, section 2).
 *
 * One function, used by catalog, the harvester and the gateway alike, so every
 * spelling of one brand meets in one place. `El Pozo`, `ElPozo`, `ELPOZO` and
 * `elpozo` are all `elpozo`; `Campofrio` with its accent is `campofrio`;
 * `Coca-Cola` is `cocacola`; `+Proteinas` with its accent is `proteinas`.
 *
 * **A text with no letters or digits has no key**, and therefore no brand.
 * LIDL's `-` and `---` become null here without a special case.
 *
 * **It is not a spelling fix.** `Hacenado` and `Hacendado` are two keys. Fixing
 * a misspelling is renaming the brand, and aliases are out of scope (section 9).
 *
 * It must stay **browser reachable**: contracts compile under the Angular apps,
 * so this file names no `process` and imports nothing from Node. It has a
 * secondary entry point of its own, `@portfolio/luna-shopper/contracts/brand-key`,
 * because the library's barrel re-exports the ajv backed schema validator: the
 * back office wants this one function and reaching it through the barrel put
 * 59 kB of JSON schema validation into a browser bundle. Its cases live
 * beside it in `brand-key.cases.json`, because the curation tool is plain `.mjs`
 * and keeps its own copy of this function, proven against the same pairs.
 */
export function brandKey(text: string | null | undefined): string | null {
  if (text == null) {
    return null;
  }
  const key = text
    // NFD splits an accented letter into the letter and its combining mark, and
    // the range below is exactly the combining marks, so what is left is the
    // plain letter. `translate` in `catalog_norm` cannot do this, which is why
    // that normalization is not the key (section 2).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return key === '' ? null : key;
}
