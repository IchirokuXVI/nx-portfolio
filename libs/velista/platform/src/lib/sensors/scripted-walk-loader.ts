import type { WalkSensorsI } from './walk-sensors';

/**
 * The scripted walk of velista `0126` (`?fakeWalk=N`), loaded only when the flag
 * asks for it, so its data never reaches a bundle that does not use it. A
 * production build swaps this file for `scripted-walk-loader.prod.ts`
 * (`fileReplacements` in apps/velista/project.json), which answers null, so the
 * scripted walk is not even a chunk there.
 */
export function loadScriptedWalkSensors(
  document: Document,
  speed: number
): WalkSensorsI | null {
  const loaded = import('./scripted-walk-sensors').then(
    (m) => new m.ScriptedWalkSensors(document, { speed })
  );
  return {
    supported: () => loaded.then((sensors) => sensors.supported()),
    start: (root, listener) =>
      loaded.then((sensors) => sensors.start(root, listener)),
  };
}
