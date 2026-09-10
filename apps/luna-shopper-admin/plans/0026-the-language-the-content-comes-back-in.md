# 0026 The language the content comes back in

The back office reads English and only English. Not because anybody chose that, but because
two separate defaults happen to agree, and neither of them was ever a decision about content.

**This plan gives the operator one setting: the language the catalog is read in.** It is a
reading order, not a filter. Nothing is hidden, no row disappears, and the interface stays in
English.

## 1. What happens today

**No request says what language the operator reads.** `app-providers.ts` line 76 installs two
interceptors, `adminAuthInterceptor` and `clientVersionInterceptor`, and there is no third. So
every gateway request arrives with no `Accept-Language` header, `resolveLocale` falls through
to `DEFAULT_LOCALE` (`libs/luna-shopper/platform/src/lib/localization/locale.ts` line 15) and
every server message answers in English. The comment above `gateway-error.ts` line 21 already
says these messages are "the server's own, already translated into the request's locale", which
is true and is exactly the problem: the request's locale is a default nobody set.

**Every localized value on screen is read English first.** `CONTENT_LOCALES` is
`['en', 'es']` (`libs/luna-shopper-admin/models/src/lib/resource/localized-text.ts` line 26)
and it is passed as the reading order at every call site: the list page (`resource-list-page.ts`
line 197), the form page (`resource-form-page.ts` line 201) and sixteen descriptor `title`
implementations, of which five collapse a localized name (`items.ts` line 46,
`product-groups.ts` line 42, `supermarkets.ts` line 46, `locations.ts` line 60,
`price-scopes.ts` line 56, `prices.ts` line 84). `localizedTextValue` walks that list in order,
so an operator working a Spanish catalog reads the English name of every product that has one,
and `missingLocales` badges Spanish as the gap.

**The interface language is a different decision and must stay one.**
`APP_AVAILABLE_LOCALES` is one entry long, English (`libs/luna-shopper-admin/ui/src/lib/app-locales.ts`
line 18). The comment beside `CONTENT_LOCALES` already draws the line and is worth keeping
whole: the operator reads English, the catalog is read by shoppers, so its names exist in both
languages, "and the form has to be able to edit both regardless of what language its own labels
are in. Conflating the two would make the Spanish name uneditable until somebody translated the
admin interface."

That is why this plan adds a second setting rather than turning on a second interface locale.
The app can stay in English forever and this setting still has to work.

## 2. The decision

**One setting, named the content language, separate from the interface language. It moves the
reading order and it goes out on every gateway request.**

Three consequences, and all three are the point rather than side effects:

- A localized value is read in the chosen language **first**, and in the other one after it. It
  is an order and never a filter, so a product named in one language only still shows a name
  rather than an empty cell, and the missing badge still marks the gap.
- Every server message, every refusal and every validation detail comes back in the chosen
  language, because the choice travels as `Accept-Language`.
- The interface, its labels, its dates and its numbers are untouched. Those follow
  `RokuTranslatorService.locale()`, which is what `toRowView` already receives separately as
  `options.locale` (`resource-list-page.ts` line 196).

## 3. Where the choice lives

A store in `data-access`, beside the other things the app remembers about the operator:

```ts
/** The language the operator reads the catalog in. One signal, persisted per browser. */
@Injectable()
export class ContentLocaleStore {
  readonly locale: Signal<string>;
  /** The content locales, the chosen one first. What every reader passes as the order. */
  readonly order: Signal<readonly string[]>;
  choose(locale: string): void;
}
```

`order()` is the value every existing call site wants, so nothing downstream learns about a
"chosen locale" at all: it keeps receiving a list of locales in preference order and keeps
falling through it. That is what makes this change small in a codebase that already threads
`contentLocales` through `toRowView`.

Persistence is `localStorage`, like `SessionStorage` beside it, keyed so it survives a reload
and a new session. A read that throws or answers nothing falls back to the first entry of
`CONTENT_LOCALES`, so a private window and a cleared browser both behave the way the app
behaves today.

An unsupported stored value is discarded rather than trusted. The store filters against
`CONTENT_LOCALES`, because a stale key from a build that served a third language must not put
a locale nobody serves at the head of the order.

## 4. The header

A third interceptor, beside the two that exist and after them, so the token and the version are
already on the request:

```ts
export const contentLocaleInterceptor: HttpInterceptorFn = (req, next) => {
  const urls = inject(ApiUrl);
  if (!urls.isGateway(req.url)) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { 'Accept-Language': inject(ContentLocaleStore).locale() } }));
};
```

The `isGateway` guard is not optional and is the reason this is a separate interceptor rather
than a line in an existing one: the rule that nothing sends a header to a URL that is not the
gateway is stated in `clientVersionInterceptor` (line 45) and holds here for the same reason.
Velista does the same thing in `gateway-interceptor.ts` line 285, and this is that half of its
behavior, applied to the back office.

## 5. `title(row)` has no order, and sixteen descriptors implement it

`ResourceDescriptor.title` is `title(row: T): string`
(`libs/luna-shopper-admin/models/src/lib/resource/resource-descriptor.ts` line 230), and its
own comment says why it is a function: "a name is usually localized text and choosing which
locale to show is a decision the descriptor makes once instead of every screen making it again."
The decision is right and the signature is now one argument short. It becomes:

```ts
title(row: T, locales: readonly string[]): string;
```

**Not an injected service.** Descriptors are module level constants built at import time
(`export const ITEMS = defineResource({...})`), so there is no injector to read from, and
`title` is called from a confirmation dialog, a form heading and a picker, each of which
already has the order in hand. A pure function of a row and an order is also what the existing
specs call.

Eleven of the sixteen implementations return a plain string (`row.username`, `row.postalCode`,
`row.itemId`) and ignore the new argument. The five that collapse a localized name pass it
through to `localizedTextValue` instead of `CONTENT_LOCALES`. `CONTENT_LOCALES` stays exported
and stays the set of languages the content is written in. What stops being a reading order is
its use as one.

## 6. A switch invalidates the page, not just the render

This is the part that looks cosmetic and is not. Once backend plan `0109` lands, the three
catalog listings order and cut their keyset cursor in the caller's language, so a page fetched
under English was sorted by English names. Re-rendering those same rows under Spanish reorders
nothing and the operator sees a Spanish sorted screen that is really an English page: the rows
are wrong, not merely out of order, because the next page continues from an English cursor.

So a change of the setting refetches from the first page and drops the cursor
(`resource-list-store.ts` is where paging state lives). Cheap, correct, and the only honest
option: the alternative is re-sorting a page of twenty rows on the client and pretending it is
a page of the whole table.

The store's `order` signal is a signal for this reason as much as for the render. A screen that
reads it inside a `computed` reacts, and the list page's fetch has one thing to watch.

## 7. Where the control sits

In the header's `.identity` block of `app-shell.ts` (line 97), beside the operator's name and
the sign out button. It is a property of who is reading rather than of what is on screen, so it
belongs with the operator and not in a screen's toolbar or in a filter bar, where it reads as
narrowing the rows.

Two content locales means two options, so a small select or a two button toggle, labelled from
the app's own translation keys. `translations.spec.ts` asserts every key an app template uses
exists (`libs/luna-shopper-admin/ui/src/lib/translations.spec.ts` line 11), so the new keys land
in the same file as the control.

## 8. What this plan does not do

- **It does not translate the interface.** `APP_AVAILABLE_LOCALES` stays one entry long. The
  labels, the buttons and the navigation stay English, and that is the arrangement section 1
  describes rather than a shortcut taken here.
- **It does not filter.** No screen gains a "products missing a Spanish name" view. The missing
  badge already answers that per row, and a filter on it is a gateway query this plan does not
  add.
- **It does not change what is written.** The form still edits every content locale, still
  submits only the languages that are filled, and still requires a name in at least one
  language (`resource-draft.ts` line 284). A reading order is not an editing order.
- **It does not touch velista.** The shopper app already sends `Accept-Language` and already
  falls through both halves of a name.

## 9. The seam with backend plan 0109

Two plans, one per direction, and they build in either order:

- **0026 alone** puts the names and the server messages in the chosen language, which is most
  of what an operator notices. Listing order stays English first until 0109 lands, because that
  order is decided in SQL.
- **0109 alone** makes the backend answer in the caller's language and changes nothing here,
  because a request with no header still resolves to English.

Section 6 is the one place where this plan depends on that one, and it is a dependency in the
safe direction: dropping the cursor on a switch is correct today and necessary afterwards.

## 10. Tests

- `ContentLocaleStore`: the default with nothing stored, a round trip through storage, a stored
  value that is not a content locale, and a storage accessor that throws.
- The interceptor: the header on a gateway request, no header on a request to any other origin,
  and the header following a change of the setting.
- `toRowView` over a row named in one language only, under each choice, asserting that the cell
  shows the name it has and still reports the gap.
- One descriptor `title` under each choice, and one of the eleven that ignore the argument, so
  the widened signature is exercised both ways.
- The list page refetching from the first page when the setting changes, asserting that the
  cursor was dropped rather than reused.
- The control rendering in the shell, and every new translation key present in the app's
  translation file.
