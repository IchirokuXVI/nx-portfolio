import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  RouterOutlet,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  TokenStore,
} from '@portfolio/velista/data-access';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { CreateGroupSheet } from './create-group-sheet';

/**
 * The back button, over the real router and a real history stack.
 *
 * `create-group-sheet.spec.ts` runs against a `Router` double, which is right for
 * everything it asserts and cannot see this defect at all: the bug is not *where* a
 * dismissal navigates but *how*, and a double records the URL and not the history
 * entry. So this spec drives the actual router over `SpyLocation`, which keeps a stack
 * and can be popped, and it presses the things a person presses.
 *
 * The scenario is the report, in the shortest form it was given in: open the dashboard,
 * press New group, cancel, then press back. Back belongs on the page before the
 * dashboard. It must never re-open the sheet, and that is what closing with a
 * `navigateByUrl` did, because a push left the sheet's URL sitting in the stack with
 * the dashboard pushed on top of it (plan 0031).
 *
 * `CreateGroupSheet` stands in for all eleven sheets here. What is under test is the
 * rule they now share through `SheetNavigation`, and this is the cheapest of them to
 * route: the others need a zone, a list or a membership before they will draw.
 */
@Component({
  selector: 'lib-test-front-door',
  template: '<h1 class="front-door">front door</h1>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestFrontDoor {}

@Component({
  selector: 'lib-test-dashboard',
  imports: [RouterOutlet],
  template: '<h1 class="dashboard">dashboard</h1><router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestDashboard {}

const FRONT_DOOR = '/velista/en';
const DASHBOARD = '/velista/en/home';
const SHEET = '/velista/en/home/zones/new';

/** The two pages the sheet hangs over, mounted where the real table mounts them. */
const routes: Routes = [
  { path: 'velista/en', component: TestFrontDoor },
  {
    path: 'velista/en/home',
    component: TestDashboard,
    children: [
      {
        path: 'zones/new',
        component: CreateGroupSheet,
        data: { returnTo: 'home' },
      },
    ],
  },
];

async function arrive(): Promise<{
  harness: RouterTestingHarness;
  location: Location;
}> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter(routes),
      provideLocationMocks(),
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeZoneStore(fakeZoneStore()),
      provideFakeSessionStore('REGISTERED'),
      { provide: TokenStore, useValue: { clear: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create();
  const location = TestBed.inject(Location);
  listenForHistory();
  listenForHistory();

  // The page before the dashboard, so a correct back press has somewhere to land that
  // is neither the sheet nor the edge of the app.
  await harness.navigateByUrl(FRONT_DOOR);
  await harness.navigateByUrl(DASHBOARD);

  return { harness, location };
}

/**
 * Let the router finish answering a history event, and redraw.
 *
 * A pop is not a `navigateByUrl`: nothing hands back a promise for it, so the spec
 * yields a macrotask for the navigation the popstate started and only then reads the
 * screen. Dismissing a sheet is a pop now too, which is why the cancel presses below
 * wait the same way.
 */
async function settle(harness: RouterTestingHarness): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve));
  await harness.fixture.whenStable();
  harness.detectChanges();
}

/** Press the browser's back button, and let the router answer it. */
async function pressBack(
  harness: RouterTestingHarness,
  location: Location
): Promise<void> {
  location.back();
  await settle(harness);
}

/** Press Cancel, and let the dismissal it starts finish. */
async function pressCancel(harness: RouterTestingHarness): Promise<void> {
  const host = harness.fixture.nativeElement as HTMLElement;
  (host.querySelector('.cancel') as HTMLButtonElement).click();
  await settle(harness);
}

/**
 * Subscribe the router to history events, which bootstrapping does for free.
 *
 * `provideRouter` in a TestBed never runs an initial navigation, and it is that call
 * which also installs the listener for everything the browser does to the history
 * stack. Without this the router simply ignores a pop, the URL moves and the screen
 * does not, and a spec about the back button would be asserting on nothing.
 */
function listenForHistory(): void {
  TestBed.inject(Router).setUpLocationChangeListener();
}

function sheetIsOnScreen(harness: RouterTestingHarness): boolean {
  const host = harness.fixture.nativeElement as HTMLElement;

  return host.querySelector('lib-sheet-shell') !== null;
}

describe('the back button, over a sheet', () => {
  it('opens the sheet as a history entry of its own', async () => {
    const { harness, location } = await arrive();

    await harness.navigateByUrl(SHEET);

    expect(location.path()).toBe(SHEET);
    expect(sheetIsOnScreen(harness)).toBe(true);
  });

  it('leaves the dashboard on screen when the sheet is cancelled', async () => {
    const { harness, location } = await arrive();
    await harness.navigateByUrl(SHEET);

    await pressCancel(harness);

    expect(location.path()).toBe(DASHBOARD);
    expect(sheetIsOnScreen(harness)).toBe(false);
  });

  it('goes back to the page before the dashboard, and not into the sheet again', async () => {
    // The report, exactly: home, New group, cancel, back. Before plan 0031 the
    // cancellation pushed the dashboard on top of the sheet, so this press landed on
    // the sheet's URL and the panel came back up over a page nobody had left.
    const { harness, location } = await arrive();
    await harness.navigateByUrl(SHEET);

    await pressCancel(harness);

    await pressBack(harness, location);

    expect(location.path()).toBe(FRONT_DOOR);
    expect(sheetIsOnScreen(harness)).toBe(false);
  });

  it('closes the sheet when back is what dismissed it, and leaves once more', async () => {
    // The other half of rule E1: back over an open sheet closes the sheet rather than
    // the page, and the press after that still leaves the dashboard.
    const { harness, location } = await arrive();
    await harness.navigateByUrl(SHEET);

    await pressBack(harness, location);

    expect(location.path()).toBe(DASHBOARD);
    expect(sheetIsOnScreen(harness)).toBe(false);

    await pressBack(harness, location);

    expect(location.path()).toBe(FRONT_DOOR);
  });

  it('replaces its own entry when the sheet is the first page of the session', async () => {
    // A cold arrival on the sheet's URL, which a reload with the panel open also is.
    // There is nothing behind it to pop, so cancelling replaces it: the dashboard is
    // drawn and the sheet's URL is gone rather than sitting one press away.
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [RokuTranslatorTestingModule.forTesting()],
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideVelistaTesting({ basePath: '/velista' }),
        provideFakeZoneStore(fakeZoneStore()),
        provideFakeSessionStore('REGISTERED'),
        { provide: TokenStore, useValue: { clear: jest.fn() } },
        { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      ],
    }).compileComponents();

    const harness = await RouterTestingHarness.create();
    const location = TestBed.inject(Location);
    await harness.navigateByUrl(SHEET);

    await pressCancel(harness);

    expect(location.path()).toBe(DASHBOARD);
    expect(sheetIsOnScreen(harness)).toBe(false);

    await pressBack(harness, location);

    expect(location.path()).not.toBe(SHEET);
  });
});
