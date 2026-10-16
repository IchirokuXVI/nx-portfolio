import {
  computed,
  effect,
  inject,
  untracked,
  type Signal,
} from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { ItemNames } from '@portfolio/velista/data-access';
import { lineName, type Line, type LineName } from '@portfolio/velista/models';

/**
 * The name a screen draws for a line, through {@link lineName} (velista `0144`,
 * section 1), with the products' names read from `ItemNames` in the reader's
 * language.
 *
 * Every page and sheet of a line takes its title from here, so none of them
 * compares names or reads `named` by itself.
 *
 * It asks `ItemNames` for the products the line holds, which answers from what it
 * holds and asks only for ids it has not seen. A sheet opened over the list or the
 * line page costs no request.
 *
 * Call from a constructor or a field initializer.
 */
export function watchLineName(
  line: () => Line | undefined
): Signal<LineName | null> {
  const items = inject(ItemNames);
  const locale = inject(RokuLocaleStore).locale;

  effect(() => {
    const itemIds = line()?.itemIds ?? [];
    if (itemIds.length > 0) {
      untracked(() => void items.ensure(itemIds));
    }
  });

  return computed(() => {
    const current = line();
    return current === undefined
      ? null
      : lineName(
          current,
          (itemId) => items.nameOf(itemId)?.name ?? null,
          locale(),
          items.pricesOf
        );
  });
}
