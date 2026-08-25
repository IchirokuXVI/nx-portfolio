# Testing (zoneless, memory-backed)

Unit and contract tests run on Jest, **zoneless** (new apps), backed by the
in-memory services so no backend is needed. e2e runs on Playwright, pointed at the
shell (never a remote's own port).

## Zoneless setup

Every app and lib uses `setupZonelessTestEnv` (not `setupZoneTestEnv`):

```ts
// src/test-setup.ts
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
```

Copy `jest.config.ts` from an existing lib. `passWithNoTests` is on, so stubs are
fine early.

## Data-access: memory spec + shared contract

Each domain's **memory** service gets a spec driving it through
`TestBed.inject(XMemory)`, asserting against the static seed with `firstValueFrom`
— no HTTP mock. See `libs/landing-v2/data-access/.../projects-memory.spec.ts`.

```ts
beforeEach(() => {
  TestBed.configureTestingModule({});
  service = TestBed.inject(XMemory);
});

it('returns the seeded list', async () => {
  const list = await firstValueFrom(service.getList('en'));
  expect(list).toHaveLength(XS.length);
});
```

When both a memory and an API impl exist, put the common behavior in
`<x>-service.shared-spec.ts` as an **exported function** — a `describe` builder,
not a self-running suite:

```ts
// x-service.shared-spec.ts
export function runSharedXServiceTests(factory: () => XServiceI) {
  describe('XServiceI contract', () => {
    it('getList returns an Observable of TranslatedX[]', () => {
      /* ... */
    });
  });
}
```

Both `<x>-memory.spec.ts` and `<x>-api.spec.ts` build their own `TestBed`
`factory()` and **call it first**, then add impl-specific tests. The memory spec
reaches into the seed; the API spec uses `provideHttpClient()`,
`provideHttpClientTesting()` + `HttpTestingController`, overriding
`OwnApiUrlResolver.getApiUrl`. See odontogram's `odontogram-service.shared-spec.ts`
+ `odontogram-memory.spec.ts`.

## Components

Standard Angular `TestBed`. Import standalone components directly; inject data via
the DI **token** so the in-memory impl backs them automatically (zero DI setup for
the consumer). For components that read translations, provide
`provideRokuTranslatorTesting()` or `RokuTranslatorTestingModule.forTesting()` from
`@portfolio/localization/rokutranslator-angular`. Add `provideRouter([])` when the
template has router bindings.

## Run

`npx nx lint <project>` and `npx nx test <project>` for every project you touch —
they must pass on your new files.
