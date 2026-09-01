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

/**
 * The question every back control in the app asks before it pops: is the entry behind
 * this one ours?
 *
 * The cases below are the arrivals a back button actually meets, and the ones that
 * matter most are the arrivals that **look** like a session with history and are not.
 * A cold load whose URL the locale guard corrects, and a sheet opened from a shared
 * link and submitted, both leave the reader on an entry the router has renumbered
 * without adding anything to the stack. The check this service replaced read that
 * renumbering as history and popped, which handed the reader whichever site had linked
 * them here.
 */

type Trigger = 'imperative' | 'popstate' | 'hashchange';

interface Step {
  /** The URL the navigation ends on, after redirects. */
  url: string;
  trigger?: Trigger;
  extras?: NavigationExtras;
  /** For a popstate: the id the restored entry was written with. */
  restoredId?: number;
}

/**
 * The router as this service sees it: a stream of events, plus the navigation being
 * announced, which is where the trigger and `replaceUrl` come from.
 */
class FakeRouter {
  readonly events = new Subject<RouterEvent>();

  private _navigation: Navigation | null = null;
  private _lastId = 0;

  getCurrentNavigation(): Navigation | null {
    return this._navigation;
  }

  /**
   * One navigation, announced the way the real one announces it: a start carrying how
   * the browser got here, then an end carrying the id the entry is written with.
   *
   * Returns that id, so a later popstate in the same test can name the entry it is
   * going back to the way the browser does.
   */
  go(step: Step): number {
    const id = ++this._lastId;
    const trigger = step.trigger ?? 'imperative';

    this._navigation = {
      id,
      trigger,
      extras: step.extras ?? {},
    } as Navigation;

    this.events.next(
      new NavigationStart(
        id,
        step.url,
        trigger,
        step.restoredId === undefined ? null : { navigationId: step.restoredId }
      )
    );
    this.events.next(new NavigationEnd(id, step.url, step.url));

    this._navigation = null;

    return id;
  }
}

function setUp(started = true): { history: AppHistory; router: FakeRouter } {
  TestBed.resetTestingModule();

  const router = new FakeRouter();

  TestBed.configureTestingModule({
    providers: [{ provide: Router, useValue: router }],
  });

  const history = TestBed.inject(AppHistory);

  if (started) {
    history.watch();
  }

  return { history, router };
}

/** The initial navigation, which the router always asks to replace. */
function arriveAt(router: FakeRouter, url: string): number {
  return router.go({ url, extras: { replaceUrl: true } });
}

describe('AppHistory', () => {
  it('has nothing behind it before anything has been navigated', () => {
    const { history } = setUp();

    expect(history.hasEntryBehind()).toBe(false);
  });

  it('has nothing behind the entry the document loaded on', () => {
    const { history, router } = setUp();

    arriveAt(router, '/velista/en/zones/z1/lists/l1');

    expect(history.hasEntryBehind()).toBe(false);
  });

  it('has something behind it once this document has pushed', () => {
    const { history, router } = setUp();

    arriveAt(router, '/velista/en/home');
    router.go({ url: '/velista/en/zones/z1/lists/l1' });

    expect(history.hasEntryBehind()).toBe(true);
  });

  describe('a renumbered entry is not a second entry', () => {
    it('says no after the locale guard corrects a cold URL', () => {
      // The arrival this exists for. A guard redirect inherits `replaceUrl` from the
      // navigation it interrupted, and the initial navigation sets it, so the corrected
      // URL replaces the entry the tab loaded on. The stack is one deep and everything
      // below it belongs to whoever linked here.
      const { history, router } = setUp();

      arriveAt(router, '/velista/zones/z1/lists/l1');
      router.go({
        url: '/velista/en/zones/z1/lists/l1',
        extras: { replaceUrl: true },
      });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('says no after a sheet opened cold leaves through leaveTo', () => {
      // `SheetNavigation.leaveTo` replaces so the spent sheet's URL stops existing. Do
      // it from the entry the document loaded on and the reader ends up on a page whose
      // entry has been renumbered twice and still has nothing of ours behind it.
      const { history, router } = setUp();

      arriveAt(router, '/velista/en/zones/z1/sheet/lists/new');
      router.go({
        url: '/velista/en/zones/z1',
        extras: { replaceUrl: true },
      });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('says no when a navigation lands on the URL already showing', () => {
      // The router replaces rather than pushes when the path does not change, so a
      // retry that re-navigates to the current screen adds nothing to the stack.
      const { history, router } = setUp();

      arriveAt(router, '/velista/en/zones/z1');
      router.go({ url: '/velista/en/zones/z1' });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('says no for a navigation that never reaches the address bar', () => {
      const { history, router } = setUp();

      arriveAt(router, '/velista/en/zones/z1');
      router.go({
        url: '/velista/en/zones/z1/lists/l1',
        extras: { skipLocationChange: true },
      });

      expect(history.hasEntryBehind()).toBe(false);
    });
  });

  describe('going back and forward again', () => {
    it('says no once the browser is back on the entry it loaded on', () => {
      const { history, router } = setUp();

      const loaded = arriveAt(router, '/velista/en/home');
      router.go({ url: '/velista/en/zones/z1' });
      router.go({
        url: '/velista/en/home',
        trigger: 'popstate',
        restoredId: loaded,
      });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('says yes on a pushed entry with another push below it', () => {
      const { history, router } = setUp();

      arriveAt(router, '/velista/en/home');
      const zone = router.go({ url: '/velista/en/zones/z1' });
      router.go({ url: '/velista/en/zones/z1/lists/l1' });
      router.go({
        url: '/velista/en/zones/z1',
        trigger: 'popstate',
        restoredId: zone,
      });

      expect(history.hasEntryBehind()).toBe(true);
    });

    it('says yes again after a forward', () => {
      const { history, router } = setUp();

      const loaded = arriveAt(router, '/velista/en/home');
      const zone = router.go({ url: '/velista/en/zones/z1' });
      router.go({
        url: '/velista/en/home',
        trigger: 'popstate',
        restoredId: loaded,
      });
      router.go({
        url: '/velista/en/zones/z1',
        trigger: 'popstate',
        restoredId: zone,
      });

      expect(history.hasEntryBehind()).toBe(true);
    });

    it('keeps recognising a pushed entry the router has renumbered', () => {
      // A replace renames the entry it lands on. The name is how a popstate says where
      // it is going, so an entry whose new name was not recorded would come back as a
      // stranger and its back button would give up and walk to its fallback.
      const { history, router } = setUp();

      const loaded = arriveAt(router, '/velista/en/home');
      router.go({ url: '/velista/en/zones/z1/sheet/lists/new' });
      const zone = router.go({
        url: '/velista/en/zones/z1',
        extras: { replaceUrl: true },
      });
      router.go({
        url: '/velista/en/home',
        trigger: 'popstate',
        restoredId: loaded,
      });
      router.go({
        url: '/velista/en/zones/z1',
        trigger: 'popstate',
        restoredId: zone,
      });

      expect(history.hasEntryBehind()).toBe(true);
    });

    it('says no when the browser restores an entry this document never wrote', () => {
      const { history, router } = setUp();

      arriveAt(router, '/velista/en/home');
      router.go({ url: '/velista/en/zones/z1' });
      router.go({
        url: '/velista/en/home',
        trigger: 'popstate',
        restoredId: 4321,
      });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('says no when the browser restores an entry with no state at all', () => {
      const { history, router } = setUp();

      arriveAt(router, '/velista/en/home');
      router.go({ url: '/velista/en/zones/z1' });
      router.go({ url: '/velista/en/home', trigger: 'popstate' });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('drops the entries the browser threw away when a push follows a back', () => {
      const { history, router } = setUp();

      const loaded = arriveAt(router, '/velista/en/home');
      const zone = router.go({ url: '/velista/en/zones/z1' });
      router.go({ url: '/velista/en/zones/z1/lists/l1' });
      router.go({
        url: '/velista/en/home',
        trigger: 'popstate',
        restoredId: loaded,
      });
      router.go({ url: '/velista/en/account' });
      // The list and the group are gone from the stack, so the id the group was written
      // with names nothing any more and cannot place the cursor above the floor.
      router.go({
        url: '/velista/en/zones/z1',
        trigger: 'popstate',
        restoredId: zone,
      });

      expect(history.hasEntryBehind()).toBe(false);
    });
  });

  it('counts an entry pushed by a hash change, which is this document too', () => {
    const { history, router } = setUp();

    arriveAt(router, '/velista/en/home');
    router.go({ url: '/velista/en/home#section', trigger: 'hashchange' });

    expect(history.hasEntryBehind()).toBe(true);
  });

  describe('being started', () => {
    it('counts nothing until the app starts it', () => {
      // A screen that injects `PageNavigation` reaches this service, and in a spec that
      // is often all that reaches it. Unstarted it answers no, so those screens fall
      // back rather than popping a stack nobody has been counting.
      const { history, router } = setUp(false);

      arriveAt(router, '/velista/en/home');
      router.go({ url: '/velista/en/zones/z1' });

      expect(history.hasEntryBehind()).toBe(false);
    });

    it('is one listener however many times the app starts it', () => {
      // `appProviders` is spread onto the route table and onto the standalone
      // bootstrap, so in the standalone build both initializers run. A second
      // subscription would count every push twice.
      const { history, router } = setUp();

      history.watch();
      history.watch();

      expect(router.events.observers).toHaveLength(1);
    });
  });

  it('says no about a navigation it was started too late to see the start of', () => {
    // Under the shell this service is constructed while the navigation that mounts the
    // app is already running, so the first end it sees has no before to compare with.
    // It answers no, which costs a fallback rather than an exit from the app.
    const { history, router } = setUp();

    router.go({ url: '/velista/en/zones/z1/lists/l1' });

    expect(history.hasEntryBehind()).toBe(false);
  });
});
