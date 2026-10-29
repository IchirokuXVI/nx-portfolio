import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AuthApi,
  GOOGLE_VERIFIER_KEY,
  TokenStore,
} from '@portfolio/velista/data-access';
import type { SessionTokens } from '@portfolio/velista/models';
import {
  BrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { AuthCallbackPage } from './auth-callback-page';

const GUEST: SessionTokens = {
  userId: 'u-guest',
  kind: 'TEMPORARY',
  username: 'guest',
  accessToken: 'guest-at',
  refreshToken: 'guest-rt',
};

const GOOGLE_PAIR: SessionTokens = {
  userId: 'u-google',
  kind: 'REGISTERED',
  username: 'dani',
  accessToken: 'google-at',
  refreshToken: 'google-rt',
};

const VERIFIER = 'v'.repeat(43);

/** Every way out replaces the callback's history entry. */
const REPLACE = { replaceUrl: true };

async function render(
  fragment: string | null,
  options: {
    verifier?: string;
    exchange?: (code: string, verifier: string) => Promise<SessionTokens>;
  } = {}
) {
  TestBed.resetTestingModule();

  // A guest pair is held on every render, so each case can say whether it survived.
  const held: { pair: SessionTokens | null } = { pair: GUEST };
  const tokens = { set: (pair: SessionTokens) => (held.pair = pair) };

  const session = new Map<string, string>();
  if (options.verifier !== undefined) {
    session.set(GOOGLE_VERIFIER_KEY, options.verifier);
  }
  const browser = {
    readSessionStorage: (key: string) => session.get(key) ?? null,
    removeSessionStorage: (key: string) => void session.delete(key),
  };

  const api = {
    exchangeGoogleCode: jest.fn(options.exchange ?? (async () => GOOGLE_PAIR)),
  };

  await TestBed.configureTestingModule({
    imports: [AuthCallbackPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      { provide: TokenStore, useValue: tokens },
      { provide: AuthApi, useValue: api },
      { provide: BrowserFacade, useValue: browser },
      { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

  const fixture = TestBed.createComponent(AuthCallbackPage);
  fixture.detectChanges();
  await fixture.whenStable();

  return { router, held, session, api };
}

/**
 * Velista `0171`: the page trades a code and this tab's verifier for the pair, and
 * stores nothing that came in the URL.
 */
describe('AuthCallbackPage', () => {
  it('sends the visitor to the front door without a fragment', async () => {
    const { router, held, api } = await render(null);

    expect(api.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(held.pair).toBe(GUEST);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en', REPLACE);
  });

  it('posts nothing for a code when this tab holds no verifier', async () => {
    // A link somebody else made: their code, and no verifier in this browser.
    const { router, held, api } = await render('code=abc');

    expect(api.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(held.pair).toBe(GUEST);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en', REPLACE);
  });

  it('trades the code and the verifier, stores the pair of the body, and goes home', async () => {
    const { router, held, session, api } = await render('code=abc', {
      verifier: VERIFIER,
    });

    expect(api.exchangeGoogleCode).toHaveBeenCalledWith('abc', VERIFIER);
    expect(held.pair).toBe(GOOGLE_PAIR);
    expect(session.has(GOOGLE_VERIFIER_KEY)).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home', REPLACE);
  });

  it('removes the verifier and goes to the front door when the exchange is refused', async () => {
    const { router, held, session } = await render('code=abc', {
      verifier: VERIFIER,
      exchange: async () => {
        throw new Error('unauthorized');
      },
    });

    expect(held.pair).toBe(GUEST);
    expect(session.has(GOOGLE_VERIFIER_KEY)).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en', REPLACE);
  });

  it('goes to the front door on an error from the gateway', async () => {
    const { router, held, api } = await render('error=unauthorized', {
      verifier: VERIFIER,
    });

    expect(api.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(held.pair).toBe(GUEST);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en', REPLACE);
  });

  it('stores nothing from a fragment that carries another account pair', async () => {
    // Test 7 of the session token review: the old fragment shape, with a pair of
    // somebody else, while a guest pair is held. The held pair survives.
    const { router, held, api } = await render(
      'userId=u-other&kind=REGISTERED&username=other&accessToken=at&refreshToken=rt',
      { verifier: VERIFIER }
    );

    expect(api.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(held.pair).toBe(GUEST);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en', REPLACE);
  });
});
