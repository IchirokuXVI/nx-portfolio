import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { BackendReadiness } from './backend-readiness';
import { ConnectionState } from './connection-state';
import { RENDERS_WHILE_CONNECTING, StartupGate } from './startup-gate';
import { provideFakeBrowserFacade } from './testing/velista-testing';

@Component({ selector: 'lib-test-page', template: 'page' })
class TestPage {}

describe('StartupGate', () => {
  let gate: StartupGate;
  let readiness: BackendReadiness;

  function build(routes: Routes = []): void {
    TestBed.configureTestingModule({
      providers: [provideFakeBrowserFacade(), provideRouter(routes)],
    });

    readiness = TestBed.inject(BackendReadiness);
    gate = TestBed.inject(StartupGate);
  }

  it('holds every page closed until the backend answers', () => {
    build();

    expect(gate.rendersNow()).toBe(false);

    readiness.reportReady();

    expect(gate.rendersNow()).toBe(true);
  });

  it('keeps holding when the backend turns out to be unreachable', () => {
    build();

    readiness.reportUnreachable();

    expect(gate.rendersNow()).toBe(false);
  });

  // D4. Exactly one route says this about itself, and it is the front door.
  it('opens for a route that renders while connecting', async () => {
    build([
      {
        path: 'landing',
        component: TestPage,
        data: { [RENDERS_WHILE_CONNECTING]: true },
      },
      { path: 'zones', component: TestPage },
    ]);

    await TestBed.inject(Router).navigate(['/landing']);

    expect(gate.rendersNow()).toBe(true);

    // And closes again on the way to a screen that needs the backend, which is every
    // other screen in the app.
    await TestBed.inject(Router).navigate(['/zones']);

    expect(gate.rendersNow()).toBe(false);
  });

  // Angular's `emptyOnly` data inheritance is what keeps the flag off the two entry
  // sheets below landing: both carry their own `data`. A deep link into one waits,
  // which is right, because that screen creates a group.
  it('does not let the flag reach a child that carries its own data', async () => {
    build([
      {
        path: 'landing',
        component: TestPage,
        data: { [RENDERS_WHILE_CONNECTING]: true },
        children: [{ path: 'sheet/zones/new', component: TestPage, data: {} }],
      },
    ]);

    await TestBed.inject(Router).navigate(['/landing/sheet/zones/new']);

    expect(gate.rendersNow()).toBe(false);
  });

  // Section 5.3. Closing the gate would destroy the live page and whatever was typed
  // into it; `lib-connection-lost` covers a page that is still there.
  it('does not close again when the connection is lost later', () => {
    build();
    readiness.reportReady();

    TestBed.inject(ConnectionState).reportNetworkFailure();
    TestBed.tick();

    expect(readiness.state()).toBe('unreachable');
    expect(gate.rendersNow()).toBe(true);
  });

  // `0072` draws the screen for a refused build. Until it does, the app runs on what
  // it has rather than sitting behind a screen that says Connecting.
  it('opens for a build the deployment refuses', () => {
    build();

    readiness.reportTooOld();

    expect(gate.rendersNow()).toBe(true);
  });
});
