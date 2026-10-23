import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AppBack,
  type AppBackOutcome,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';
import {
  DEFAULT_NATIVE_APP_ID,
  inAppUrl,
  NativeShell,
  storeUrlFor,
} from './native-shell';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

describe('inAppUrl', () => {
  it.each([
    ['https://staging.velista.app/join/ABCDEF', '/join/ABCDEF'],
    ['https://velista.app/s/secret', '/s/secret'],
    [
      'https://velista.app/auth/reset-password?token=t&mode=sign-in',
      '/auth/reset-password?token=t&mode=sign-in',
    ],
    [
      'https://velista.app/es/auth/impersonate#code=c',
      '/es/auth/impersonate#code=c',
    ],
    ['https://velista.app', '/'],
  ])('follows %s to %s', (url, path) => {
    expect(inAppUrl(url)).toBe(path);
  });

  it.each(['not a url', 'app.velista://join/ABC', 'http://velista.app/join/A'])(
    'ignores %s',
    (url) => {
      expect(inAppUrl(url)).toBeNull();
    }
  );
});

describe('storeUrlFor', () => {
  it('names the app id on Google Play', () => {
    expect(storeUrlFor('app.velista.staging')).toBe(
      'https://play.google.com/store/apps/details?id=app.velista.staging'
    );
  });
});

describe('NativeShell', () => {
  let doubles: NativePluginDoubles;
  let outcome: AppBackOutcome;
  let navigateByUrl: jest.Mock;
  let session: Map<string, string>;

  function setUp(): NativeShell {
    doubles = new NativePluginDoubles();
    outcome = 'floor';
    navigateByUrl = jest.fn(() => Promise.resolve(true));
    session = new Map();
    TestBed.configureTestingModule({
      providers: [
        { provide: NATIVE_PLUGINS, useValue: doubles.loader },
        { provide: AppBack, useValue: { request: () => outcome } },
        { provide: Router, useValue: { navigateByUrl } },
        provideFakeBrowserFacade(new Map(), {
          readSessionStorage: (key: string) => session.get(key) ?? null,
          writeSessionStorage: (key: string, value: string) =>
            void session.set(key, value),
        }),
      ],
    });
    return TestBed.inject(NativeShell);
  }

  describe('the hardware back button', () => {
    it.each(['handled', 'popped'] as const)(
      'stays in the app when the press is %s',
      async (answer) => {
        const shell = setUp();
        await shell.start();
        outcome = answer;

        doubles.listeners.get('backButton')?.();
        await Promise.resolve();

        expect(doubles.minimized).toBe(0);
      }
    );

    it('minimizes at the floor instead of closing the app', async () => {
      const shell = setUp();
      await shell.start();
      outcome = 'floor';

      doubles.listeners.get('backButton')?.();
      await Promise.resolve();

      expect(doubles.minimized).toBe(1);
    });
  });

  describe('links that open the app', () => {
    it('pushes a link that arrives while the app runs', async () => {
      const shell = setUp();
      await shell.start();

      doubles.listeners.get('appUrlOpen')?.({
        url: 'https://staging.velista.app/join/ABCDEF',
      });

      expect(navigateByUrl).toHaveBeenCalledWith('/join/ABCDEF', {
        replaceUrl: false,
      });
    });

    it('follows the launch link of a cold start once, replacing the entry', async () => {
      const shell = setUp();
      doubles.launchUrl = 'https://velista.app/s/secret?x=1';

      await shell.start();

      expect(navigateByUrl).toHaveBeenCalledTimes(1);
      expect(navigateByUrl).toHaveBeenCalledWith('/s/secret?x=1', {
        replaceUrl: true,
      });
    });

    it('does not follow the launch link again after a reload', async () => {
      const shell = setUp();
      doubles.launchUrl = 'https://velista.app/s/secret';
      // What the first document of this WebView session left behind.
      session.set('native-launch-url-followed:velista', '1');

      await shell.start();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('starts at the root when the app was opened from its icon', async () => {
      const shell = setUp();

      await shell.start();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  it('learns its app id for the store link, and names production until then', async () => {
    const shell = setUp();
    expect(shell.appId).toBe(DEFAULT_NATIVE_APP_ID);

    await shell.start();
    await Promise.resolve();

    expect(shell.appId).toBe('app.velista.staging');
  });

  it('registers its listeners once however often it is started', async () => {
    const shell = setUp();

    await Promise.all([shell.start(), shell.start()]);

    expect(doubles.loads).toBe(1);
  });
});
