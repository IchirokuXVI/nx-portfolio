import { TestBed } from '@angular/core/testing';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import {
  DEPLOYMENT_SERVICE,
  type DeploymentServiceI,
} from './deployment-service';
import { DeploymentStore } from './deployment-store';

/** A service whose one read resolves when the test says so, and counts its calls. */
function deferredService() {
  let settle: (value: Deployment | null) => void = () => undefined;
  let calls = 0;

  const service: DeploymentServiceI = {
    read: () => {
      calls += 1;
      return new Promise<Deployment | null>((resolve) => {
        settle = resolve;
      });
    },
  };

  return {
    service,
    calls: () => calls,
    settle: (value: Deployment | null) => settle(value),
  };
}

/** Let the promise chain inside `load` run. `whenStable` hangs in a zoneless spec. */
const drain = () => Promise.resolve().then(() => undefined);

describe('DeploymentStore', () => {
  function setup(service: DeploymentServiceI) {
    TestBed.configureTestingModule({
      providers: [
        { provide: DEPLOYMENT_SERVICE, useValue: service },
        DeploymentStore,
      ],
    });
    return TestBed.inject(DeploymentStore);
  }

  it('is undefined until the read settles, and never a guess', () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    store.load();

    // Not `development`, and not `null` either: the app has not failed to find out,
    // it has not finished asking. The page renders through this without claiming
    // anything.
    expect(store.deployment()).toBeUndefined();
  });

  it('holds what the gateway said', async () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    store.load();
    deferred.settle('production');
    await drain();

    expect(store.deployment()).toBe('production');
  });

  /**
   * A gateway that will not say leaves this `null`, which the screens render as an
   * explicit "unknown". Falling back to a named environment here would manufacture
   * the confident wrong answer the whole feature exists to prevent.
   */
  it('holds null when the deployment could not be established', async () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    store.load();
    deferred.settle(null);
    await drain();

    expect(store.deployment()).toBeNull();
  });

  it('reads once however many times it is asked to', () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    store.load();
    store.load();
    store.load();

    expect(deferred.calls()).toBe(1);
  });
});
