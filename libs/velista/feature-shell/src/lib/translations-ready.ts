import { inject } from '@angular/core';
import { type ResolveFn } from '@angular/router';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { firstValueFrom } from 'rxjs';

/**
 * Holds the app's first navigation until its strings have arrived (plan 0006,
 * section 4).
 *
 * ## Why block at all, when the pipe repaints
 *
 * rokutranslator 0004 gave the service a `loaded` signal that the pipe reads, so a
 * view that painted keys is marked dirty and re-translates when the load finishes.
 * That removes **stuck** keys and every app gets it. It does not remove the **flash**,
 * because there is still a paint with keys in it, and on this app's anonymous screen
 * there is almost nothing but text: the flash is the entire first impression. The wait
 * costs one already bundled chunk on a route that is lazily loaded anyway, so it
 * overlaps work the router is doing regardless.
 *
 * ## Why there is no timeout
 *
 * Deliberately, and it is worth saying so, because a timer looks like cheap insurance
 * to anybody debugging a slow load. It is not insurance, it is nondeterminism: the
 * same build would render translated text on a developer's machine and raw keys on a
 * cheap phone on bad signal, with nothing in the source saying which. It cannot tell
 * "failed" from "slow", it makes a test of the failure path prove something about the
 * timer instead of about the loader, and it hides the defect it compensates for.
 *
 * What makes a timer unnecessary is a contract rather than an absence: `loaded$` emits
 * **exactly one** value and then completes, in the success case and the failure case
 * alike (rokutranslator 0004, Problem 3). A loader that rejects settles it with
 * `false`, so this promise always resolves and the route always activates, at worst
 * with keys for the namespace that failed. Both halves matter, and the second is the
 * sharp one: `firstValueFrom` on an observable that completes **without** emitting
 * rejects with `EmptyError`, which would cancel the navigation and leave a blank page,
 * the exact outcome this is built to prevent.
 *
 * `loaded$` is a `ReplaySubject(1)`, so every navigation after the first resolves from
 * the buffer and this costs nothing once the app is running.
 */
export const translationsReadyResolver: ResolveFn<boolean> = () =>
  firstValueFrom(inject(RokuTranslatorService).loaded$);
