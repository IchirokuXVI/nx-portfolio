/**
 * A brand name with only the first letter of each word in capitals.
 *
 * Chains print brands in whatever case their system keeps, so the same brand
 * arrives as `HACENDADO`, `hacendado` and `Hacendado`. The register panel offers
 * this as the name a person starts from, and the chain's own spelling stays one
 * press away.
 *
 * A word starts at any letter with no letter, digit or apostrophe before it, so
 * `COCA-COLA ZERO` becomes `Coca-Cola Zero` and `+PROTEÍNAS` becomes
 * `+Proteínas`. An apostrophe does not start one, because `DON'T` has to become
 * `Don't`. A digit does not either, because `7UP` is `7up` and not `7Up`. Every
 * other letter goes to lower case, with the Spanish rules, since every chain
 * this catalog reads is Spanish.
 *
 * The case never changes the key (`brandKey` folds case), so capitalizing a name
 * cannot unlink the products the suggestion was about.
 */
export function capitalizeBrand(name: string): string {
  return name
    .toLocaleLowerCase('es')
    .replace(/(?<![\p{L}\p{N}'’])\p{L}/gu, (letter) =>
      letter.toLocaleUpperCase('es')
    );
}
