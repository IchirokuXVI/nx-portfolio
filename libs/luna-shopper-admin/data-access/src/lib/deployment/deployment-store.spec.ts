import { TestBed } from '@angular/core/testing';
import {
  UNKNOWN_ENVIRONMENT,
  type AdminEnvironment,
} from '@portfolio/luna-shopper-admin/models';
import {
  DEPLOYMENT_SERVICE,
  type DeploymentServiceI,
} from './deployment-service';
import { DeploymentStore } from './deployment-store';

/** A service whose one read resolves when the test says so, and counts its calls. */
function deferredService() {
  let settle: (value: AdminEnvironment) => void = () => undefined;
  let calls = 0;

  const service: DeploymentServiceI = {
    read: () => {
      calls += 1;
      return new Promise<AdminEnvironment>((resolve) => {
        settle = resolve;
      });
    },
  };

  return {
    service,
    calls: () => calls,
    settle: (value: AdminEnvironment) => settle(value),
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

    void store.load();

    // Not `development`, and not `null` either: the app has not failed to find out,
    // it has not finished asking. The page renders through this without claiming
    // anything.
    expect(store.deployment()).toBeUndefined();
    expect(store.settled()).toBe(false);
  });

  it('holds what the gateway said', async () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    void store.load();
    deferred.settle({ deployment: 'production', devAutologin: false });
    await drain();

    expect(store.deployment()).toBe('production');
    expect(store.settled()).toBe(true);
  });

  /**
   * A gateway that will not say leaves this `null`, which the screens render as an
   * explicit "unknown". Falling back to a named environment here would manufacture
   * the confident wrong answer the whole feature exists to prevent.
   */
  it('holds null when the deployment could not be established', async () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    void store.load();
    deferred.settle(UNKNOWN_ENVIRONMENT);
    await drain();

    expect(store.deployment()).toBeNull();
  });

  it('reads once however many times it is asked to', () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    void store.load();
    void store.load();
    void store.load();

    expect(deferred.calls()).toBe(1);
  });

  /**
   * `SessionBootstrap` awaits this to decide whether to attempt an autologin, and
   * a second caller must get the same in flight read rather than start another
   * one. Asserted through the promise rather than the call count, because that is
   * the property the bootstrap actually depends on.
   */
  it('answers every caller with the one read', async () => {
    const deferred = deferredService();
    const store = setup(deferred.service);

    const first = store.load();
    const second = store.load();
    deferred.settle({ deployment: 'staging', devAutologin: false });
    await Promise.all([first, second]);

    expect(deferred.calls()).toBe(1);
    expect(store.deployment()).toBe('staging');
  });

  describe('devAutologin', () => {
    /**
     * The safe direction, and the reason this is a separate signal rather than a
     * read of the environment object: the app shows its login screen while it does
     * not know, and skips it only once a server has said in as many words that it
     * may.
     */
    it('is false before the read settles', () => {
      const deferred = deferredService();
      const store = setup(deferred.service);

      void store.load();

      expect(store.devAutologin()).toBe(false);
    });

    it('is false when the gateway could not be reached', async () => {
      const deferred = deferredService();
      const store = setup(deferred.service);

      void store.load();
      deferred.settle(UNKNOWN_ENVIRONMENT);
      await drain();

      expect(store.devAutologin()).toBe(false);
    });

    it('is true only because the gateway said so', async () => {
      const deferred = deferredService();
      const store = setup(deferred.service);

      void store.load();
      deferred.settle({ deployment: 'development', devAutologin: true });
      await drain();

      expect(store.devAutologin()).toBe(true);
    });
  });
});
