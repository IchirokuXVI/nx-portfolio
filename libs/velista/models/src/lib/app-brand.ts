import { InjectionToken } from '@angular/core';

/**
 * Everything that carries product identity, in one object (plan 0002, section 5).
 *
 * Rule N1 (plan 0001): the product name must never be hardcoded in a component, a
 * CSS token, a route path, a class name, a translation key, or an asset filename.
 * It appears only as **values** here and in the translation JSON. The product has
 * already been renamed once, so a rename stays a data edit rather than a refactor.
 *
 * The two brand asset **files** are the one deliberate exception, since the mark is
 * the identity itself.
 */
export interface AppBrand {
  /** Full product name. Display only. Never used as an identifier. */
  readonly name: string;
  /** Short form for tight spaces such as the header and the tab title. */
  readonly shortName: string;
  /** Wordmark and icon assets, resolved at runtime, never inlined into a template. */
  readonly wordmarkSrc: string;
  readonly iconSrc: string;
  /** Optional theme override, so a rebrand can ship a palette with the name. */
  readonly themeClass?: string;
}

export const APP_BRAND = new InjectionToken<AppBrand>('APP_BRAND');
