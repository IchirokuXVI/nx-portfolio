# Data access: the in-memory service pattern (required)

This is the core of "runs and tests with no backend". Every data domain ships an
in-memory service behind an interface + DI token, seeded from static `.ts` data.
An API implementation is optional and swapped in per-environment later. Copy from
`libs/landing-v2/data-access/src/lib/project/*` and
`libs/odontogram/data-access/src/lib/odontogram/*`.

The shared primitives live in `@portfolio/shared/data-access`: `serviceToken`,
`provideService`, `ApiConsumer`, `OwnApiUrlResolver`, `NotFoundResourceError`
(plus `InMemoryFilter` in `@portfolio/shared/util`).

## Files per domain `<x>`

1. **`static-<x>-data.ts`** — the structural table: `export const XS: readonly
   StaticX[] = [...]` (locale-independent fields: ids, slugs, tags, links, lazy
   asset `import()`s).
2. **`static-<x>-translation-data.ts`** — per-locale copy: `export const
   XS_TRANSLATIONS: readonly XTranslation[] = [...]`, one row per (record ×
   locale), `en` present as fallback. Skip only for a domain with no translatable
   content. (This is the repo's realization of "one file for the record, one for
   its translations".)
3. **`<x>-service.ts`** — the interface **and** the DI token:

   ```ts
   import { inject } from '@angular/core';
   import { serviceToken } from '@portfolio/shared/data-access';
   import { XMemory } from './x-memory';

   export interface XServiceI {
     getList(locale: string, filter?: XFilter): Observable<TranslatedX[]>;
     getById(id: string, locale: string): Observable<TranslatedX>;
   }

   // Inject THIS token (typed as the interface), never the concrete class.
   export const X_SERVICE = serviceToken<XServiceI>(
     'X_SERVICE',
     () => inject(XMemory), // default = in-memory impl
   );
   ```

4. **`<x>-memory.ts`** — `@Injectable({ providedIn: 'root' })` class
   `implements XServiceI`, joining the structural row with its localized row
   (fallback to `en`), resolving lazy assets, and returning `of(...)`. Use
   `InMemoryFilter` (`setFilterConfig` with per-field `check` fns like
   `filterIncludesAny`, `textSearch`) for list filtering, `NotFoundResourceError`
   for misses, and `uuidv4()` for ids on create. See `projects-memory.ts` /
   `odontogram-memory.ts`.

Export everything flat from the data-access `index.ts`.

## The DI token helpers

```ts
// serviceToken: root-provided InjectionToken whose default factory is the memory impl.
export function serviceToken<T>(description: string, defaultImpl: () => T) {
  return new InjectionToken<T>(description, { providedIn: 'root', factory: defaultImpl });
}
// provideService: bind the token to an impl AND provide it. Reach for this one.
export function provideService<T>(token: InjectionToken<T>, impl: Type<T>) {
  return { provide: token, useClass: impl };
}
// useService: alias the token to an impl provided elsewhere (a `providedIn: 'root'`
// singleton). Never constructs anything, so it fails if the impl provides itself
// nowhere. Only worth it to avoid duplicating a stateful root singleton.
export function useService<T>(token: InjectionToken<T>, impl: Type<T>) {
  return { provide: token, useExisting: impl };
}
```

**Which one:** `provideService` unless the implementation is `providedIn: 'root'` *and*
something injects the concrete class directly. A remote's services often cannot be root
provided at all, because under module federation the root injector belongs to the host
(see velista plan 0005), and `useService` cannot help there.

Consumers `inject(X_SERVICE)` typed as `XServiceI` — they depend on the contract,
not the implementation.

## The optional API implementation

Add only when a backend exists:

```ts
@Injectable({ providedIn: 'root' })
export class XApi extends ApiConsumer implements XServiceI {
  private _http = inject(HttpClient);
  private _endpoint = '/xs';
  constructor() {
    super(inject(OwnApiUrlResolver)); // resolves BACK_API_* env → base URL
  }
  // requests hit `${this._url}${this._endpoint}`, mapping HTTP 404 → NotFoundResourceError
}
```

**Switch implementations per environment** at a route/remote injector with
`provideService(X_SERVICE, XApi)` — do **not** change the token's default. Today
everything runs in memory.

## Testing

Memory-backed and contract-based — see `references/testing.md`.
