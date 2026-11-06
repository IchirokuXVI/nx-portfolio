import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

// jsdom has no layout, and its `scrollTo` is a stub that reports "Not
// implemented" through `console.error`, with the whole Angular stack under the
// call. A split page calls it each time a row opens on a narrow screen
// (`ResourceSplitPage.opened`), so the record specs here logged it more than a
// hundred times a file. Jest formats each of those stacks, and on CI that cost
// pushed the first test of a file, which also pays the cold compile, past the
// five second timeout. A spec that asserts on scrolling spies on it, as
// `resource-split-page.spec.ts` does.
window.scrollTo = () => undefined;
