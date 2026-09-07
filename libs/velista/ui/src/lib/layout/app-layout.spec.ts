import { Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { type AppBrand } from '@portfolio/velista/models';
import {
  BackendReadiness,
  ConnectionState,
  provideVelistaTesting,
  RENDERS_WHILE_CONNECTING,
  ThemeStore,
} from '@portfolio/velista/platform';
import { AppLayout } from './app-layout';

/** A page below the layout, so a route can actually activate under it. */
@Component({ selector: 'lib-test-page', template: 'page' })
class TestPage {}

async function createFixture(
  override: Partial<AppBrand> = {},
  routes: Routes = []
): Promise<ComponentFixture<AppLayout>> {
  await TestBed.configureTestingModule({
    imports: [AppLayout, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter(routes),
      provideVelistaTesting({ brand: override }),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppLayout);
  fixture.detectChanges();
  return fixture;
}

function outletOf(fixture: ComponentFixture<AppLayout>): Element | null {
  return (fixture.nativeElement as HTMLElement).querySelector('router-outlet');
}

describe('AppLayout', () => {
  // Plan 0001, the extraction contract, item 4: the app's tokens live on its own
  // root element, never on `:root`, so the shell's global styles and this app's
  // tokens cannot reach each other.
  it('carries the token scope and the default theme on one element', async () => {
    const fixture = await createFixture();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-night');
  });

  it('follows the theme store when the choice changes', async () => {
    const fixture = await createFixture();
    const host: HTMLElement = fixture.nativeElement;

    TestBed.inject(ThemeStore).setPreference('day');
    fixture.detectChanges();

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-day');
    expect(host.classList).not.toContain('theme-night');
  });

  it('lets the brand pin a theme, so a rebrand ships its palette', async () => {
    const fixture = await createFixture({ themeClass: 'theme-dusk' });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-dusk');

    // A brand that ships one palette means one palette: the preference is inert,
    // because a `theme-day` the rebrand never defined would leave the app with
    // primitives and no semantic layer.
    TestBed.inject(ThemeStore).setPreference('day');
    fixture.detectChanges();

    expect(host.classList).toContain('theme-dusk');
    expect(host.classList).not.toContain('theme-day');
  });

  it('renders the outlet every page mounts into once the backend answers', async () => {
    const fixture = await createFixture();

    TestBed.inject(BackendReadiness).reportReady();
    fixture.detectChanges();

    expect(outletOf(fixture)).not.toBeNull();
  });

  /**
   * The startup gate, plan 0071. The outlet is **held** rather than covered: a page
   * constructed behind a screen runs its resolvers and sends its requests on behalf of
   * somebody who has just been told to wait.
   */
  describe('the startup gate', () => {
    it('does not create the outlet while it is still connecting', async () => {
      const fixture = await createFixture();

      expect(outletOf(fixture)).toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'lib-startup-screen'
        )
      ).not.toBeNull();
    });

    it('keeps holding it when the backend turns out to be unreachable', async () => {
      const fixture = await createFixture();

      TestBed.inject(BackendReadiness).reportUnreachable();
      fixture.detectChanges();

      expect(outletOf(fixture)).toBeNull();
    });

    it('opens it as soon as the backend answers, with no reload', async () => {
      const fixture = await createFixture();

      TestBed.inject(BackendReadiness).reportUnreachable();
      fixture.detectChanges();
      expect(outletOf(fixture)).toBeNull();

      TestBed.inject(BackendReadiness).reportReady();
      fixture.detectChanges();

      expect(outletOf(fixture)).not.toBeNull();
    });

    // D4. Landing is the one route that draws while connecting, and it says so itself.
    it('creates the outlet for a route that renders while connecting', async () => {
      const fixture = await createFixture({}, [
        {
          path: 'landing',
          component: TestPage,
          data: { [RENDERS_WHILE_CONNECTING]: true },
        },
      ]);

      await TestBed.inject(Router).navigate(['/landing']);
      fixture.detectChanges();

      expect(outletOf(fixture)).not.toBeNull();
    });

    it('holds it for a route that does not carry the flag', async () => {
      const fixture = await createFixture({}, [
        { path: 'zones', component: TestPage },
      ]);

      await TestBed.inject(Router).navigate(['/zones']);
      fixture.detectChanges();

      expect(outletOf(fixture)).toBeNull();
    });

    // Angular's `emptyOnly` inheritance is what keeps the flag from spreading: a child
    // carrying its own `data` does not inherit the parent's, so a deep link into an
    // entry sheet waits like every other screen.
    it('holds it for a child of that route that carries its own data', async () => {
      const fixture = await createFixture({}, [
        {
          path: 'landing',
          component: TestPage,
          data: { [RENDERS_WHILE_CONNECTING]: true },
          children: [
            { path: 'sheet/zones/new', component: TestPage, data: {} },
          ],
        },
      ]);

      await TestBed.inject(Router).navigate(['/landing/sheet/zones/new']);
      fixture.detectChanges();

      expect(outletOf(fixture)).toBeNull();
    });

    // Section 5.3: the gate is about **starting**. A connection lost afterwards is
    // covered by a screen over a page that is still there, not by destroying it.
    it('does not close again when the connection is lost later', async () => {
      const fixture = await createFixture();
      TestBed.inject(BackendReadiness).reportReady();
      fixture.detectChanges();

      TestBed.inject(ConnectionState).reportNetworkFailure();
      fixture.detectChanges();

      expect(TestBed.inject(BackendReadiness).state()).toBe('unreachable');
      expect(outletOf(fixture)).not.toBeNull();
    });

    // `0072` draws the screen for this. Until it does, the app runs on what it has
    // rather than sitting behind a screen that says Connecting when the truth is a
    // refused build.
    it('opens for a build the deployment refuses', async () => {
      const fixture = await createFixture();

      TestBed.inject(BackendReadiness).reportTooOld();
      fixture.detectChanges();

      expect(outletOf(fixture)).not.toBeNull();
    });

    it('asks for a retry when the startup screen does', async () => {
      const fixture = await createFixture();
      const readiness = TestBed.inject(BackendReadiness);

      fixture.componentInstance.retryConnection();

      expect(readiness.retryRequested()).toBe(1);
    });
  });

  /**
   * Losing the connection later is unchanged: the page below is already alive, so the
   * blocking screen is drawn **over** a live outlet rather than instead of it, and its
   * half typed fields survive the reload being deferred.
   */
  it('covers a live outlet when the connection is lost after startup', async () => {
    const fixture = await createFixture();
    TestBed.inject(BackendReadiness).reportReady();
    fixture.detectChanges();

    TestBed.inject(ConnectionState).reportNetworkFailure();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('lib-connection-lost')).not.toBeNull();
    expect(outletOf(fixture)).not.toBeNull();
  });
});
