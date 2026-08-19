# ToothImageLoader — populate the image cache

> Fixes the `FIXME` in
> `libs/odontogram/ui/src/lib/services/tooth-image-loader.ts:24`.

## Problem

`ToothImageLoader.loadImage()` holds a `loadedImages` Map meant to memoize the
per-tooth image bundle, but nothing ever writes to it. The early
`this.loadedImages.get(toothNumber)` lookup always misses, so every call builds a fresh
`forkJoin` of four dynamic `import()`s. It only appears to work because the bundler
already dedupes the dynamic imports, so the cache is dead code, not a functional bug.

## Goal

Make the Map actually memoize: store the observable back on first load, share the
result across subscribers, and return the cached observable on subsequent calls, so
each tooth's four assets resolve into a single shared, replayed observable.

## Change

In `loadImage(toothNumber)`, after the cache-miss branch, build the `forkJoin`, pipe it
through `shareReplay(1)` so late subscribers get the resolved value without re-running
the imports, store it in the Map, and return the stored observable.

```ts
loadImage(toothNumber: (typeof TeethNumbers)[number]) {
  const cached = this.loadedImages.get(toothNumber);
  if (cached) {
    return cached;
  }

  const image$ = forkJoin({
    lateral: import(`../../../assets/teeth/${toothNumber}_root.png`).then((m) => m.default),
    crown: import(`../../../assets/teeth/${toothNumber}_crown.png`).then((m) => m.default),
    root_mask: import(`../../../assets/teeth/${toothNumber}_root_mask.png`).then((m) => m.default),
    crown_mask: import(`../../../assets/teeth/${toothNumber}_crown_mask.png`).then((m) => m.default),
  }).pipe(shareReplay(1));

  this.loadedImages.set(toothNumber, image$);
  return image$;
}
```

Add `shareReplay` to the existing `rxjs` import. Remove the `FIXME` comment once done.

## Notes / decisions

- `shareReplay(1)` is deliberate: without it, each new subscriber to the cached
  observable would re-trigger the `import()` promises, defeating the purpose. With
  `refCount` left at its default (`false`) the replay buffer survives even when
  subscriber count drops to zero, which is what we want for a long-lived cache.
- Error handling: if an import rejects, the cached observable will replay that error to
  future subscribers. Assets are static and always present, so caching the failure is
  acceptable; if that ever becomes a concern, guard with `catchError` that removes the
  entry from the Map before rethrowing.
- The service is `providedIn: 'root'`, so the cache lives for the app session — correct
  for immutable tooth assets.

## Verification

- `npx nx test odontogram-ui` (add/adjust a spec: two `loadImage` calls for the same
  tooth return the same observable reference; different teeth return different ones).
- `npx nx lint odontogram-ui`
- Manual: open the odontogram through the shell, select teeth, confirm images render
  and repeated selections reuse the cached observable (no duplicate network/import
  work in devtools).
