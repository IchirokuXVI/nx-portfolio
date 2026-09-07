import { Component, type Provider } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { type AppBrand } from '@portfolio/velista/models';
import {
  BackendReadiness,
  ConnectionState,
  provideFakeBrowserFacade,
  provideVelistaTesting,
  RENDERS_WHILE_CONNECTING,
  StorageKeys,
  ThemeStore,
} from '@portfolio/velista/platform';
import { AppLayout } from './app-layout';

/** A page below the layout, so a route can actually activate under it. */
@Component({ selector: 'lib-test-page', template: 'page' })
class TestPage {}

async function createFixture(
  override: Partial<AppBrand> = {},
  routes: Routes = [],
  extra: Provider[] = []
): Promise<ComponentFixture<AppLayout>> {
  await TestBed.configureTestingModule({
    imports: [AppLayout, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter(routes),
      provideVelistaTesting({ brand: override }),
      // `AppUpdates` is real here and it acts on a refusal: with no worker it spends
      // this document's one attempt and reloads (plan 0072 D6). The double keeps that
      // out of jsdom's `location`, and gives every fixture its own `sessionStorage`,
      // without which the first refused fixture would leave the rest of the file
      // looking like a tab that had already tried.
      provideFakeBrowserFacade(),
      ...extra,
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

    // It opens, and `0072`'s screen takes the place the outlet would have had. What
    // it does not do is hold the word Connecting in front of somebody whose build the
    // deployment will not serve, which is a thing that is not true.
    it('opens for a build the deployment refuses', async () => {
      const fixture = await createFixture();

      TestBed.inject(BackendReadiness).reportTooOld();
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('lib-startup-screen')).toBeNull();
      expect(host.querySelector('lib-update-screen')).not.toBeNull();
    });

    it('asks for a retry when the startup screen does', async () => {
      const fixture = await createFixture();
      const readiness = TestBed.inject(BackendReadiness);

      fixture.componentInstance.retryConnection();

      expect(readiness.retryRequested()).toBe(1);
    });
  });

  /**
   * Plan 0072. A refused build is wrong about everything: every request it makes comes
   * back 426, so it usually looks offline as well, and this is the one screen that
   * tells the truth about why.
   */
  describe('a build the deployment refuses', () => {
    it('replaces the app, landing included', async () => {
      // D1. Landing draws while connecting because a front door in a tunnel is worth
      // having, and all four of its actions end in a request this server will not
      // answer, so there is nothing left worth showing.
      const fixture = await createFixture({}, [
        {
          path: 'landing',
          component: TestPage,
          data: { [RENDERS_WHILE_CONNECTING]: true },
        },
      ]);

      await TestBed.inject(Router).navigate(['/landing']);
      TestBed.inject(BackendReadiness).reportTooOld();
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('lib-update-screen')).not.toBeNull();
      expect(outletOf(fixture)).toBeNull();
    });

    it('replaces a page that was already running', async () => {
      const fixture = await createFixture();
      TestBed.inject(BackendReadiness).reportReady();
      fixture.detectChanges();
      expect(outletOf(fixture)).not.toBeNull();

      TestBed.inject(BackendReadiness).reportTooOld();
      fixture.detectChanges();

      expect(outletOf(fixture)).toBeNull();
    });

    it('wins over the connection screen', async () => {
      const fixture = await createFixture();
      TestBed.inject(BackendReadiness).reportReady();
      fixture.detectChanges();

      // Which is what a refused build looks like from the outside: every request
      // fails, so the transport reports itself as gone.
      TestBed.inject(ConnectionState).reportNetworkFailure();
      TestBed.inject(BackendReadiness).reportTooOld();
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('lib-update-screen')).not.toBeNull();
      expect(host.querySelector('lib-connection-lost')).toBeNull();
    });

    it('draws the updating face while the attempt is still outstanding', async () => {
      const fixture = await createFixture();

      TestBed.inject(BackendReadiness).reportTooOld();
      TestBed.tick();
      fixture.detectChanges();

      // No button: there is nothing for the user to do yet, and the screen says what
      // is happening rather than asking them to fix it.
      const screen = (fixture.nativeElement as HTMLElement).querySelector(
        'lib-update-screen'
      );
      expect(screen?.querySelector('button')).toBeNull();
    });

    it('offers one reload from the dead end, and takes it', async () => {
      // A tab that already spent its attempt, which is the D4 loop being refused.
      const reload = jest.fn();
      const session = new Map([[StorageKeys.updateAttempt, '1']]);
      const fixture = await createFixture({}, [], [
        provideFakeBrowserFacade(new Map(), {
          reload,
          readSessionStorage: (key: string) => session.get(key) ?? null,
          writeSessionStorage: (key: string, value: string) =>
            void session.set(key, value),
          removeSessionStorage: (key: string) => void session.delete(key),
        }),
      ] as Provider[]);

      TestBed.inject(BackendReadiness).reportTooOld();
      TestBed.tick();
      fixture.detectChanges();

      // The app itself reloaded nothing: that is the whole of D4.
      expect(reload).not.toHaveBeenCalled();

      const button = (fixture.nativeElement as HTMLElement).querySelector(
        'lib-update-screen button'
      ) as HTMLButtonElement | null;
      button?.click();

      expect(reload).toHaveBeenCalledTimes(1);
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
