import { Location } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AppHistory } from './app-history';

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
 * `fallbackUrl` is not optional, and it is not only for the arrival that has nothing
 * behind it at all: a shared link opened cold, a reload. It is also what keeps the
 * button inside velista. The entry below the one a tab loaded on belongs to whoever
 * linked here, so popping onto it would hand the reader another site from a control
 * whose whole promise is one screen back inside this one. `AppHistory` is what tells
 * the two arrivals apart, and it says no unless the entry behind is one this document
 * pushed.
 *
 * So the button walks up to the parent instead, which is exactly the destination it
 * used to have. That navigation pushes, because it genuinely is a step forward to a
 * screen this session has not seen; only a sheet, whose URL has to stop existing,
 * replaces (see `SheetNavigation`).
 */
@Injectable({ providedIn: 'root' })
export class PageNavigation {
  private readonly _router = inject(Router);
  private readonly _location = inject(Location);
  private readonly _history = inject(AppHistory);

  async back(fallbackUrl: string): Promise<void> {
    if (this._history.hasEntryBehind()) {
      this._location.back();
      return;
    }

    await this._router.navigateByUrl(fallbackUrl);
  }
}
