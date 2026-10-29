import { effect, untracked, type Signal } from '@angular/core';

/**
 * Run `act` each time a counter moves, and never on the first read (velista `0169`).
 *
 * A reconnect, like a resume, is an **edge**, and an edge cannot be read out of a
 * boolean: a consumer that missed the transition cannot tell "came back a moment ago"
 * from "has been here all along". So the realtime client counts its reconnects, and a
 * store that reacts to them compares the count against the one it last saw.
 *
 * An `effect` runs once on creation with whatever value the counter holds then, and
 * that first run must act on nothing: the remembered value is seeded with the current
 * one under `untracked`, so only a later change differs from it. `act` runs under
 * `untracked` too, so whatever it reads never becomes a dependency of the edge.
 *
 * Only a rise is an edge. The realtime counter falls back to zero on a sign out, and
 * a sign out is not a reconnect: reading the account's state again at that moment
 * would ask the server for data the session no longer owns. A fall is remembered, so
 * the next connect after it, from zero to one, is a rise again.
 *
 * An `effect` and not `toObservable`: `@angular/core/rxjs-interop` is a secondary
 * entry point module federation does not dedupe, and a service several remotes provide
 * throws `NG0203` from it with a correct DI graph. `effect` is core.
 *
 * Call it in an injection context, as a constructor does. It runs no timer and reads
 * no global, so it is safe on the server (velista `0166`, section 2).
 */
export function onEdge(counter: Signal<number>, act: () => void): void {
  let seen = untracked(counter);
  effect(() => {
    const value = counter();
    untracked(() => {
      const rose = value > seen;
      seen = value;
      if (rose) {
        act();
      }
    });
  });
}
