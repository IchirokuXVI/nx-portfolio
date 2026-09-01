import { Location } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { hasEntryBehind } from './history-entries';

/**
 * What the back button in a page's top left corner does.
 *
 * It goes back. Not to a parent chosen when the screen was written, which is what every
 * one of these buttons used to do: the list page walked to its group, the group page to
 * the dashboard, the members page to its group. That reads correctly only when the
 * person arrived the way the route table is shaped, and half the time they did not. A
 * list opened from the dashboard is the plain case, and its back button used to land on
 * a group screen nobody had asked to see.
 *
 * So the button is the browser's back button, in the corner where a thumb can reach it.
 * The chevron and the gesture agree, and a person who reached a screen by three
 * different routes gets the one answer that is right in all three.
 *
 * `fallbackUrl` is for the arrival that has nothing behind it: a shared link opened
 * cold, a reload. The button cannot be inert there, so it walks up to the parent
 * instead, which is exactly the destination it used to have. That navigation pushes,
 * because it genuinely is a step forward to a screen this session has not seen; only a
 * sheet, whose URL has to stop existing, replaces (see `SheetNavigation`).
 */
@Injectable({ providedIn: 'root' })
export class PageNavigation {
  private readonly _router = inject(Router);
  private readonly _location = inject(Location);

  async back(fallbackUrl: string): Promise<void> {
    if (hasEntryBehind(this._location)) {
      this._location.back();
      return;
    }

    await this._router.navigateByUrl(fallbackUrl);
  }
}
