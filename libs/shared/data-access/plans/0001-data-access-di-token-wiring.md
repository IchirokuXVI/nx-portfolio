# Data access DI token wiring fix

> Brief for a future session. Implement the fix described here; the sites are already
> flagged in code with `TODO(di-wiring)` comments pointing back to this file.

## Problem

Components (and a couple of data-access services) inject a **concrete implementation**
(`*Memory`, `*Api`, `*Mock`) directly. Because of that, the real or API implementation
cannot be swapped in without editing every injection site. Each service already has an
interface (`*ServiceI`) and, in the odontogram case, a fully written API implementation
that is simply never wired up. This is why the deployed odontogram runs entirely in
memory even though `OdontogramApi` exists.

## Recommended solution

For each service interface, bind the interface to an implementation through an Angular
DI token instead of importing the concrete class in consumers:

1. Define an `InjectionToken<XServiceI>` per service (for example `ODONTOGRAM_SERVICE`).
2. Provide it at the app or route level, choosing the implementation by environment
   (in-memory for the portfolio demo, the API implementation when a real backend
   exists). Use `useClass` or `useExisting`.
3. Change consumers to inject the token instead of the concrete class.
4. Consider a small shared helper in `libs/shared/data-access` to standardize declaring
   these tokens and providers so every scope does it the same way.

Tests (`*.spec.ts`) intentionally inject concrete implementations and should stay as is.

## Sites to fix (production, non-spec)

### Consumer components
1. `libs/landing-v2/feature-project/src/lib/project-page/project-page.ts` — `ProjectMemory`
2. `libs/odontogram/ui/src/lib/tooth-treatments-modal/tooth-treatments-modal.ts` — `ToothTreatmentMemory`, `OdontogramMemory`
3. `libs/landing-v2/feature-shell/src/lib/landing-v2-wrapper/landing-v2-wrapper.ts` — `ProjectMemory`, `InfoFactMemory`
4. `libs/damoclesSword/ui/src/lib/trailer-video/trailer-video.ts` — `AssetMemory`
5. `libs/damoclesSword/ui/src/lib/contact-form/contact-form.ts` — `ContactMock` (typed as `ContactServiceI`)
6. `libs/landing/feature-shell/src/lib/landing-wrapper/landing-wrapper.ts` — `ProjectMemory`
7. `libs/odontogram/feature-full-odontogram-crud/src/lib/feature-full-odontogram-crud/feature-full-odontogram-crud.ts` — `TreatmentMemory`, `ToothTreatmentMemory`, `OdontogramMemory`
8. `libs/damoclesSword/ui/src/lib/section-news/section-news.ts` — `NewsMemory`
9. `libs/damoclesSword/ui/src/lib/section-projects/section-projects.ts` — `ProjectMemory`

### Data-access internal composition (related, lower priority)
10. `libs/damoclesSword/data-access/src/lib/project/project-memory.ts` — injects `AssetMemory`
11. `libs/damoclesSword/data-access/src/lib/news/news-memory.ts` — injects `AssetMemory`

## Notes

- `contact-form` uses a `ContactMock` placeholder pending a real backend endpoint (see
  `contact-mock.ts`). It is already typed against `ContactServiceI`, so it is the closest
  to correct; it just needs the token and a real implementation.
- The odontogram already has a complete `OdontogramApi`, so it is the best first target
  to prove the token pattern end to end.
- The two data-access internal cases are the same idea one level down (a memory service
  hardcoding `AssetMemory` instead of an asset service token); fix them once the token
  helper exists.

## Deliverable

Implement the token pattern, wire providers by environment, update every consumer
injection above, and keep all tests green. Then remove the `TODO(di-wiring)` comments.
