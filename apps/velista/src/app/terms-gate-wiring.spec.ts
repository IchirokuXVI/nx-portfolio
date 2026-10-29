import {
  createEnvironmentInjector,
  EnvironmentInjector,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeProfileStore,
  profileFor,
  provideFakeProfileStore,
  provideFakeSessionStore,
  TokenStore,
  type FakeIdentity,
  type FakeProfileStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type AccountTerms } from '@portfolio/velista/models';
import { appPath, TermsGate } from '@portfolio/velista/platform';
import { appProviders } from './app-providers';

/**
 * The wiring in `app-providers.ts` that tells `TermsGate` where the account stands
 * (velista `0173`, target 8).
 *
 * `terms-gate.spec.ts` drives the gate with values handed in. This drives the mapping
 * that hands them in, from a faked `ProfileStore` and `SessionStore`, through the
 * route injector the router builds (`app-providers.spec.ts` says why it is built by
 * hand).
 */
describe('appProviders: the terms gate wiring (velista 0173)', () => {
  const OWED: AccountTerms = {
    currentVersion: '2026-10-01',
    acceptedVersion: null,
    acceptanceRequired: true,
  };

  function setUp(
    kind: FakeIdentity,
    terms: AccountTerms | undefined
  ): {
    injector: EnvironmentInjector;
    gate: TermsGate;
    profile: FakeProfileStore;
  } {
    const profile = fakeProfileStore({
      profile:
        terms === undefined
          ? null
          : profileFor({
              kind: kind === 'TEMPORARY' ? 'TEMPORARY' : 'REGISTERED',
              terms,
            }),
    });
    const overrides: Provider[] = [
      provideFakeProfileStore(profile),
      provideFakeSessionStore(kind),
      { provide: APP_BASE_PATH, useValue: '' },
    ];
    const injector = createEnvironmentInjector(
      [...appProviders, ...overrides],
      TestBed.inject(EnvironmentInjector),
      'Route: velista'
    );
    TestBed.tick();
    return { injector, gate: injector.get(TermsGate), profile };
  }

  it('asks for the terms only when signed in and the profile says they are owed', () => {
    const owed = setUp('REGISTERED', OWED);
    expect(owed.gate.required()).toBe(true);
    expect(owed.gate.version()).toBe('2026-10-01');

    TestBed.resetTestingModule();
    const accepted = setUp('REGISTERED', {
      ...OWED,
      acceptedVersion: '2026-10-01',
      acceptanceRequired: false,
    });
    expect(accepted.gate.required()).toBe(false);
    expect(accepted.gate.acceptedBefore()).toBe(true);

    // A profile still held from before a sign out asks nothing of nobody.
    TestBed.resetTestingModule();
    const signedOut = setUp('anonymous', OWED);
    expect(signedOut.gate.required()).toBe(false);
    expect(signedOut.gate.promptShown()).toBe(false);

    TestBed.resetTestingModule();
    const noProfile = setUp('REGISTERED', undefined);
    expect(noProfile.gate.required()).toBe(false);
    expect(noProfile.gate.version()).toBeNull();
  });

  it('reads an empty current version as no version, and so draws no prompt', () => {
    const { gate } = setUp('REGISTERED', { ...OWED, currentVersion: '' });

    expect(gate.version()).toBeNull();
    expect(gate.promptShown()).toBe(false);
  });

  it('follows the profile when it changes', () => {
    const { gate, profile } = setUp('REGISTERED', OWED);

    profile.setProfile(
      profileFor({
        terms: {
          ...OWED,
          acceptedVersion: '2026-10-01',
          acceptanceRequired: false,
        },
      })
    );
    TestBed.tick();

    expect(gate.required()).toBe(false);
  });

  it('offers no sign out to a guest, who would lose the account with it', () => {
    const guest = setUp('TEMPORARY', OWED);
    expect(guest.gate.required()).toBe(true);
    expect(guest.gate.canSignOut()).toBe(false);

    TestBed.resetTestingModule();
    const registered = setUp('REGISTERED', OWED);
    expect(registered.gate.canSignOut()).toBe(true);
  });

  it('accepts through the profile store, with the version the account was asked for', async () => {
    const { gate, profile } = setUp('REGISTERED', OWED);

    await gate.accept();

    expect(profile.calls).toContainEqual({
      method: 'acceptTerms',
      version: '2026-10-01',
    });
  });

  it('signs out by clearing the pair and the profile, then lands on the front door', () => {
    const { injector, gate, profile } = setUp('REGISTERED', OWED);
    const clearTokens = jest.spyOn(injector.get(TokenStore), 'clear');
    const navigate = jest
      .spyOn(injector.get(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    gate.signOut();

    expect(clearTokens).toHaveBeenCalledTimes(1);
    expect(profile.calls).toContainEqual({ method: 'clear' });
    expect(navigate).toHaveBeenCalledWith(
      appPath(injector.get(RokuLocaleStore).locale(), '')
    );
  });
});
