import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  NavigationStart,
  Router,
  type Navigation,
  type NavigationExtras,
  type Event as RouterEvent,
} from '@angular/router';
import { Subject } from 'rxjs';
import { AppHistory } from './app-history';
import { PageNavigation } from './page-navigation';

/**
 * The rule every page's top left back button now follows.
 *
 * The two cases are named here so an edit that quietly turns the pop back into a walk
 * to a fixed parent fails, which is the defect this service exists to fix: a list
 * opened from the dashboard used to send its reader to a group screen they had never
 * asked to see.
 *
 * The other direction is the reason `fallbackUrl` is required rather than optional. A
 * back button with nothing of ours behind it may not pop, because what is behind it is
 * another site. Which arrivals leave nothing of ours behind is `AppHistory`'s subject,
 * and `app-history.spec.ts` works through them; this spec only cares that a no sends
 * the reader to the URL the screen named.
 *
 * `describe('walking up from a link')` is the third thing, and it is about what a
 * sequence of presses does rather than what one press does. One press is right either
 * way; it is the second that told us the fallback had to replace.
 */
function setUp(entryBehind: boolean): {
  pages: PageNavigation;
  back: jest.Mock;
  navigateByUrl: jest.Mock;
} {
  TestBed.resetTestingModule();

  const back = jest.fn();
  const navigateByUrl = jest.fn().mockResolvedValue(true);

  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { navigateByUrl } },
      { provide: Location, useValue: { back } },
      { provide: AppHistory, useValue: { hasEntryBehind: () => entryBehind } },
    ],
  });

  return { pages: TestBed.inject(PageNavigation), back, navigateByUrl };
}

describe('PageNavigation', () => {
  it('pops the entry behind this one, whatever page that is', async () => {
    const { pages, back, navigateByUrl } = setUp(true);

    await pages.back('/velista/en/zones/z1');

    expect(back).toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('walks to the fallback when nothing of this app is behind the page', async () => {
    // A shared link opened cold, and every arrival that only looks deeper than it is.
    // Popping would leave the app for whichever site linked the reader here, and an
    // inert button is not an option either.
    const { pages, back, navigateByUrl } = setUp(false);

    await pages.back('/velista/en/zones/z1');

    expect(back).not.toHaveBeenCalled();
    // Replaced, not pushed. The walk stands in for history the arrival did not come
    // with, so it may not leave the screen it is walking away from behind the one it
    // lands on: the next press would find that entry and pop back down into it.
    // `walking up from a link` is that sequence, and it is what this argument protects.
    expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/zones/z1', {
      replaceUrl: true,
    });
  });
});

/** An entry in the tab's stack: where it points, and the id it was written with. */
interface Entry {
  id: number;
  url: string;
}

/**
 * The tab, as far as these two services can tell: a stack of entries, a cursor into it,
 * and the router's event stream announcing every move.
 *
 * The unit cases above stand a double in for each collaborator and assert the call.
 * That cannot see this defect, because every single press was already correct. The bug
 * lives in what one press leaves behind for the next one, so the thing to model is the
 * stack itself, and then to press the button repeatedly and watch where the reader ends
 * up.
 *
 * It follows the router's own rule for push versus replace (`setBrowserUrl`): it
 * replaces when the caller asked for it or when the URL is already showing, and pushes
 * otherwise, discarding whatever was ahead. A popstate keeps the id its entry was
 * written with, which is the simplification `app-history.spec.ts` makes too. The real
 * router renames that entry, and `AppHistory` then stops recognising it and reports the
 * floor: an under-count, which costs a fallback rather than an exit, and which lands on
 * the same URL at every step of the walk below.
 */
class FakeBrowser {
  readonly events = new Subject<RouterEvent>();

  /** Every URL the reader has been shown, in order, so a walk can be read as a whole. */
  readonly visited: string[] = [];

  private _stack: Entry[] = [];
  private _cursor = -1;
  private _navigation: Navigation | null = null;
  private _lastId = 0;

  /** What the address bar shows. */
  get url(): string {
    return this._stack[this._cursor].url;
  }

  getCurrentNavigation(): Navigation | null {
    return this._navigation;
  }

  /**
   * The entry the tab loaded on: a link followed from somewhere else, or a reload.
   *
   * The browser wrote that entry before any of this code ran, so the initial navigation
   * only renames it, which is why an arrival replaces. Below it sits whoever linked
   * here, and this fake refuses to go there.
   */
  arriveAt(url: string): void {
    this._stack = [{ id: ++this._lastId, url }];
    this._cursor = 0;
    this.visited.push(url);
    this._announce(this._stack[0].id, url, 'imperative', { replaceUrl: true });
  }

  navigateByUrl(url: string, extras: NavigationExtras = {}): Promise<boolean> {
    const id = ++this._lastId;

    if (extras.replaceUrl === true || url === this.url) {
      this._stack[this._cursor] = { id, url };
    } else {
      this._stack = [...this._stack.slice(0, this._cursor + 1), { id, url }];
      this._cursor = this._stack.length - 1;
    }

    this.visited.push(url);
    this._announce(id, url, 'imperative', extras);

    return Promise.resolve(true);
  }

  /**
   * The browser has already moved by the time the navigation is announced, which is
   * why `AppHistory` places its cursor on the start rather than on the end.
   *
   * Stepping below the floor is the one thing a back button may never do, so rather
   * than model the site the reader would land on, this throws. Any press that reaches
   * it fails the test that made it.
   */
  back(): void {
    if (this._cursor === 0) {
      throw new Error(
        `back() from ${this.url} left velista for whoever linked here`
      );
    }

    this._cursor -= 1;

    const entry = this._stack[this._cursor];

    this.visited.push(entry.url);
    this._announce(++this._lastId, entry.url, 'popstate', {}, entry.id);
  }

  private _announce(
    id: number,
    url: string,
    trigger: 'imperative' | 'popstate',
    extras: NavigationExtras,
    restoredId?: number
  ): void {
    this._navigation = { id, trigger, extras } as Navigation;

    this.events.next(
      new NavigationStart(
        id,
        url,
        trigger,
        restoredId === undefined ? null : { navigationId: restoredId }
      )
    );
    this.events.next(new NavigationEnd(id, url, url));

    this._navigation = null;
  }
}

const HOME = '/velista/en/home';
const GROUP = '/velista/en/zones/z1';
const LIST = '/velista/en/zones/z1/lists/l1';
const LINE = '/velista/en/zones/z1/lists/l1/lines/li1';
const OTHER_LIST = '/velista/en/zones/z1/lists/l2';
const OTHER_GROUP = '/velista/en/zones/z2';

/** The fallback each of those screens names, straight from the pages themselves. */
const PARENT_OF: Record<string, string> = {
  [LINE]: LIST,
  [LIST]: GROUP,
  [OTHER_LIST]: GROUP,
  [GROUP]: HOME,
  [OTHER_GROUP]: HOME,
};

function walkFrom(url: string): {
  browser: FakeBrowser;
  press: () => Promise<void>;
  open: (to: string) => Promise<unknown>;
} {
  TestBed.resetTestingModule();

  const browser = new FakeBrowser();

  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: browser },
      { provide: Location, useValue: browser },
    ],
  });

  TestBed.inject(AppHistory).watch();

  const pages = TestBed.inject(PageNavigation);

  browser.arriveAt(url);

  return {
    browser,
    /** The chevron in the top left corner, on whatever screen is showing. */
    press: () => pages.back(PARENT_OF[browser.url]),
    /** A tap that opens a screen, which is the ordinary forward navigation. */
    open: (to: string) => browser.navigateByUrl(to),
  };
}

describe('walking up from a link', () => {
  it('does not come back down the way it went up', async () => {
    // The report, in two presses. The chevron reached the group, and the next press
    // returned to the list, because the walk to the group had pushed the list behind it
    // and `AppHistory` was right to say there was an entry of ours back there.
    const { browser, press } = walkFrom(LIST);

    await press();
    expect(browser.url).toBe(GROUP);

    await press();
    expect(browser.url).toBe(HOME);
  });

  it('climbs the hierarchy over five presses, pushes and all', async () => {
    // A whole session that starts on a link: screens walked to with nothing behind
    // them, and screens opened by hand and popped off again. The two kinds interleave,
    // which is the point. A walk must leave nothing for a later press to pop, and a
    // genuine push must still be there to be popped.
    const { browser, press, open } = walkFrom(LINE);

    await press();
    expect(browser.url).toBe(LIST);

    await press();
    expect(browser.url).toBe(GROUP);

    // A second list, opened from the group. This one is a real step forward, so its
    // press pops rather than walking.
    await open(OTHER_LIST);
    await press();
    expect(browser.url).toBe(GROUP);

    await press();
    expect(browser.url).toBe(HOME);

    await open(OTHER_GROUP);
    await press();
    expect(browser.url).toBe(HOME);

    // No screen was returned to after being left, which is the whole claim: every press
    // went up or back, and none of them went down.
    expect(browser.visited).toEqual([
      LINE,
      LIST,
      GROUP,
      OTHER_LIST,
      GROUP,
      HOME,
      OTHER_GROUP,
      HOME,
    ]);
  });

  it('keeps every press inside the app', async () => {
    // `FakeBrowser.back` throws rather than stepping below the entry the tab loaded on,
    // so a walk that pops one press too far fails here instead of quietly handing the
    // reader whichever site linked them in.
    const { browser, press } = walkFrom(LINE);

    await press();
    await press();
    await press();

    expect(browser.url).toBe(HOME);
  });
});
