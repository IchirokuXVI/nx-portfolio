import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { TokenStore } from '@portfolio/velista/data-access';
import type { SessionTokens } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { AuthCallbackPage } from './auth-callback-page';

async function render(fragment: string | null) {
  TestBed.resetTestingModule();

  const stored: SessionTokens[] = [];
  const tokens = { set: (pair: SessionTokens) => void stored.push(pair) };

  await TestBed.configureTestingModule({
    imports: [AuthCallbackPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      { provide: TokenStore, useValue: tokens },
      { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

  const fixture = TestBed.createComponent(AuthCallbackPage);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, router, stored };
}

/**
 * Plan 0009 section 5.6: built now, inert until the gateway redirects here with the
 * pair in the fragment instead of answering JSON. Both halves are asserted, because
 * the inert half is the one that ships today and the other is what it is for.
 */
describe('AuthCallbackPage', () => {
  it('is inert without a fragment, and sends the visitor to the front door', async () => {
    const { router, stored } = await render(null);

    expect(stored).toHaveLength(0);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en');
  });

  it('stores a pair from the fragment and goes to the dashboard', async () => {
    const { router, stored } = await render(
      'userId=u1&kind=REGISTERED&username=dani&accessToken=at&refreshToken=rt'
    );

    expect(stored[0]).toEqual({
      userId: 'u1',
      kind: 'REGISTERED',
      username: 'dani',
      accessToken: 'at',
      refreshToken: 'rt',
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
  });

  it('stores nothing from a fragment it could not map', async () => {
    // This is an unauthenticated redirect target, so anybody can put anything in the
    // fragment. Rule D4 is what stops a half formed pair being written, and a pair
    // that cannot be mapped is treated as no pair rather than as an error worth a
    // screen.
    const { router, stored } = await render('accessToken=at');

    expect(stored).toHaveLength(0);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en');
  });
});
