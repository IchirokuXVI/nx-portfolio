import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { ImpersonationState } from './impersonation-state';
import { READ_BEFORE_TERMS, TermsGate } from './terms-gate';
import { provideFakeBrowserFacade } from './testing/velista-testing';

@Component({ selector: 'lib-test-page', template: 'page' })
class TestPage {}

const ROUTES: Routes = [
  { path: 'home', component: TestPage },
  {
    path: 'terms',
    component: TestPage,
    data: { [READ_BEFORE_TERMS]: true },
  },
  {
    path: 'auth/register',
    component: TestPage,
    children: [
      {
        path: 'sheet/terms',
        component: TestPage,
        data: { [READ_BEFORE_TERMS]: true },
      },
    ],
  },
];

describe('TermsGate (velista 0173)', () => {
  let gate: TermsGate;

  function build(options: { support?: boolean } = {}): void {
    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(),
        provideRouter(ROUTES),
        ...(options.support
          ? [{ provide: ImpersonationState, useValue: { active: true } }]
          : []),
      ],
    });

    gate = TestBed.inject(TermsGate);
  }

  it('asks nothing until it is told', () => {
    build();

    expect(gate.required()).toBe(false);
    expect(gate.version()).toBeNull();
    expect(gate.promptShown()).toBe(false);
  });

  it('draws the prompt when the account must accept', async () => {
    build();
    await TestBed.inject(Router).navigate(['/home']);

    gate.report(true, '2026-10-29');

    expect(gate.promptShown()).toBe(true);
  });

  it('does not draw it when nothing is required', async () => {
    build();
    await TestBed.inject(Router).navigate(['/home']);

    gate.report(false, '2026-10-29');

    expect(gate.promptShown()).toBe(false);
  });

  it('stands down on a page somebody must read first, and comes back after', async () => {
    build();
    const router = TestBed.inject(Router);
    gate.report(true, '2026-10-29');

    await router.navigate(['/terms']);
    expect(gate.promptShown()).toBe(false);

    await router.navigate(['/home']);
    expect(gate.promptShown()).toBe(true);
  });

  it('reads the flag on the deepest route only', async () => {
    build();
    const router = TestBed.inject(Router);
    gate.report(true, '2026-10-29');

    await router.navigate(['/auth/register/sheet/terms']);
    expect(gate.promptShown()).toBe(false);

    await router.navigate(['/auth/register']);
    expect(gate.promptShown()).toBe(true);
  });

  it('never draws it, and never accepts, in a support session', async () => {
    build({ support: true });
    await TestBed.inject(Router).navigate(['/home']);
    const acceptor = jest.fn(async () => undefined);
    gate.handleAccept(acceptor);

    gate.report(true, '2026-10-29');
    await gate.accept();

    expect(gate.promptShown()).toBe(false);
    expect(acceptor).not.toHaveBeenCalled();
  });

  it('calls the acceptor once with the version, and a second press while accepting does nothing', async () => {
    build();
    let finish!: () => void;
    const acceptor = jest.fn(
      (_version: string) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    gate.handleAccept(acceptor);
    gate.report(true, '2026-10-29');

    const first = gate.accept();
    expect(gate.state()).toBe('accepting');
    await gate.accept();

    expect(acceptor).toHaveBeenCalledTimes(1);
    expect(acceptor).toHaveBeenCalledWith('2026-10-29');

    finish();
    await first;
    expect(gate.state()).toBe('idle');
  });

  it('says it failed when the acceptor rejects, and a new version clears that', async () => {
    build();
    gate.handleAccept(async () => {
      throw new Error('offline');
    });
    gate.report(true, '2026-10-29');

    await gate.accept();
    expect(gate.state()).toBe('failed');

    gate.report(true, '2026-10-29+2026-12-01', { acceptedBefore: true });
    expect(gate.state()).toBe('idle');
    expect(gate.version()).toBe('2026-10-29+2026-12-01');
    expect(gate.acceptedBefore()).toBe(true);
  });

  it('offers sign out only when told it may and a handler exists', () => {
    build();
    const signOut = jest.fn();

    gate.report(true, '2026-10-29', { canSignOut: true });
    expect(gate.canSignOut()).toBe(false);

    gate.handleSignOut(signOut);
    expect(gate.canSignOut()).toBe(true);

    gate.report(true, '2026-10-29', { canSignOut: false });
    gate.signOut();
    expect(signOut).not.toHaveBeenCalled();

    gate.report(true, '2026-10-29', { canSignOut: true });
    gate.signOut();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
