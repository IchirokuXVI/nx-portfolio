import { Location } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

/**
 * How a sheet leaves the screen, so the back button never brings it back.
 *
 * Rule E1 (plan 0008) makes every sheet a child route of the page it covers, which is
 * exactly what gives the back button something to pop. Closing one by navigating to
 * the page underneath undoes that: `navigateByUrl` **pushes**, so cancelling leaves the
 * stack reading page, sheet, page, and the next back press lands on the sheet's own URL
 * and opens it a second time. That is the defect plan 0031 fixes, and it applied to
 * every sheet in the app because all eleven closed the same way.
 *
 * So a sheet never pushes. It pops the entry it was opened with when there is one, and
 * replaces that entry when there is not. Either way the sheet's URL stops existing, and
 * back from the page beneath goes on to whatever the person was looking at before.
 */
@Injectable({ providedIn: 'root' })
export class SheetNavigation {
  private readonly _router = inject(Router);
  private readonly _location = inject(Location);

  /**
   * Cancel, Escape, the scrim, the back button itself, and a save that returns to the
   * page the sheet was covering.
   *
   * `fallbackUrl` is that page, and it is used only when this sheet is the first thing
   * the document navigated to: its URL was opened directly, or the tab was reloaded
   * with the sheet on screen. There is nothing to pop in that case, so the sheet's
   * entry is replaced instead, which keeps it out of the stack there too.
   */
  async dismiss(fallbackUrl: string): Promise<void> {
    if (this._openedOverAPage()) {
      this._location.back();
      return;
    }

    await this.leaveTo(fallbackUrl);
  }

  /**
   * Leave for somewhere that is not the page underneath: the dashboard once a group
   * exists, the group once a list is deleted, the front door once an account is gone.
   *
   * A replace and not a push, for the same reason `dismiss` pops. The work the sheet
   * asked for is done, so its URL has to stop existing; pushing would leave a spent
   * form one back press away, which for the create sheets means a second group.
   */
  async leaveTo(url: string): Promise<void> {
    await this._router.navigateByUrl(url, { replaceUrl: true });
  }

  /**
   * Whether there is an entry behind this one that this document put there.
   *
   * The router stamps every history entry with the id of the navigation that wrote it,
   * counting from one, so an id above one means this document navigated at least once
   * before arriving here and `back` returns to that. Everything else reads as no: a
   * null state after a cold load, and any entry this app did not write. Being wrong in
   * that direction costs a replaced entry, while being wrong the other way would send
   * somebody out of the app.
   */
  private _openedOverAPage(): boolean {
    const state = this._location.getState() as {
      navigationId?: unknown;
    } | null;

    return typeof state?.navigationId === 'number' && state.navigationId > 1;
  }
}
