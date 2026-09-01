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
 * used to have. **That walk replaces the entry it stands on**, and getting it the other
 * way round is the defect this paragraph exists to prevent.
 *
 * The walk used to push, on the reasoning that the parent is a screen this session has
 * not seen and is therefore a step forward. It is not a step forward. It is this button
 * standing in for the history the arrival did not come with, and pushing it leaves the
 * screen the reader is walking away from sitting directly behind the one they land on.
 * The next press then finds an entry of ours behind it and pops straight back down into
 * it: from a list opened by link, one press reached its group and the second returned to
 * the list, which is a back button going forward. Its cause was the button's own
 * fallback, not the counting in `AppHistory`.
 *
 * Replacing keeps a cold arrival on the floor for as long as it is walking, so presses
 * climb the hierarchy (line, list, group, home) rather than bouncing between two
 * screens. It costs the deep linked URL, which is the entry being replaced: the
 * browser's own gesture from the parent now leaves velista instead of returning to it.
 * That is the floor's existing bargain rather than a new one, because the gesture would
 * have left velista one press earlier, from the screen the link opened.
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

    await this._router.navigateByUrl(fallbackUrl, { replaceUrl: true });
  }
}
