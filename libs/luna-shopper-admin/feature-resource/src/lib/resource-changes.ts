import { Injectable, signal } from '@angular/core';

/**
 * Who wrote to which resource, for a list that stays on screen while it
 * happens (admin plan 0042).
 *
 * A list used to be gone by the time a row of it was saved: the form was a
 * page of its own, and going back built the list again and read it again. A
 * chain's shops are now a column beside the shop that is open, so the column
 * is still there when the shop is renamed or deleted, showing what was true
 * before.
 *
 * So a write says which resource it wrote to, and a list that is still drawn
 * reads again. A counter per resource and nothing else: what changed is the
 * gateway's to answer, and a list that guessed would be showing a row nobody
 * read.
 */
@Injectable({ providedIn: 'root' })
export class ResourceChanges {
  private readonly _versions = signal<Readonly<Record<string, number>>>({});

  /** A row of this resource was created, changed or deleted. */
  wrote(resource: string): void {
    this._versions.update((versions) => ({
      ...versions,
      [resource]: (versions[resource] ?? 0) + 1,
    }));
  }

  /**
   * How many writes this resource has seen. It only ever grows, and reading it
   * inside an effect or a computed follows it.
   */
  version(resource: string): number {
    return this._versions()[resource] ?? 0;
  }
}
