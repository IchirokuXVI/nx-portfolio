import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import {
  PAGE_FRAME_TABS,
  PageHeader,
  type PageTab,
} from '@portfolio/luna-shopper-admin/ui';

/** What the info button of Shoppers says (admin plan 0045, target 7). */
export const SHOPPERS_INFO: InfoContent = {
  title: 'people.shoppers.info.title',
  points: ['people.shoppers.info.zone', 'people.shoppers.info.person'],
};

/**
 * The Shoppers section (admin plan 0045, target 1): one header, two tabs, and
 * under them the tab that is open.
 *
 * It replaced six screens in a flat row. Two of them could not load without a
 * zone or a list picked in a filter, and the data had a shape the row did not
 * show: a zone holds its members and its lists, a list holds its lines, and a
 * person is in zones and owns shopping lists. People and Zones are the two
 * tabs, and everything else is a tab of a person or of a zone.
 *
 * The tabs are the frame's: the section names People and Zones as its two
 * screens, and the count of join requests sits on Zones.
 *
 * **They are drawn once, here.** Every page header draws the frame's tabs
 * under itself unless told otherwise, and a form or a list opened inside this
 * page has a header of its own. So this page hands the frame's tabs to its own
 * header and gives everything under it none: a zone's form would otherwise
 * repeat "People, Zones" under its title, one row below the same two tabs.
 *
 * **While a person or a zone is open on a narrow screen, that row is the
 * page**, and its own header stands where this one did. On a wide screen the
 * row is a pane beside its list, under this header.
 */
@Component({
  selector: 'lib-shoppers-page',
  imports: [PageHeader, RouterOutlet, RokuTranslatorPipe],
  providers: [{ provide: PAGE_FRAME_TABS, useValue: signal([]) }],
  template: `
    <div [class.under-row]="rowOpen()" class="shoppers-head">
      <lib-page-header
        [heading]="'shell.sections.shoppers' | rokuT"
        [info]="info"
        [tabs]="tabs()"
        [tabsLabel]="'shell.sections.shoppers' | rokuT"
      />
    </div>
    <router-outlet />
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    @media (max-width: 71.99rem) {
      .shoppers-head.under-row {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppersPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** The frame's own tabs, read past the empty ones this page provides. */
  private readonly _frameTabs = inject(PAGE_FRAME_TABS, {
    optional: true,
    skipSelf: true,
  });

  readonly info = SHOPPERS_INFO;

  /** People and Zones, with the count the frame put on Zones. */
  readonly tabs = computed<readonly PageTab[]>(() => this._frameTabs?.() ?? []);

  /**
   * Whether a row is open under the tab: a route two levels down.
   *
   * Written by hand from the router's events, for the reason `AdminShellPage`
   * gives.
   */
  readonly rowOpen = signal(this._isRowOpen());

  constructor() {
    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.rowOpen.set(this._isRowOpen());
      }
    });
    inject(DestroyRef).onDestroy(() => events.unsubscribe());
  }

  private _isRowOpen(): boolean {
    const tab = this._route.snapshot.firstChild;
    return tab != null && tab.firstChild !== null;
  }
}
