import { TestBed } from '@angular/core/testing';
import {
  ADMIN_REACHABILITY_POLICY,
  DEFAULT_REACHABILITY_POLICY,
} from '@portfolio/luna-shopper-admin/models';
import { HEALTH_SERVICE, type HealthServiceI } from './health-service';
import { ServerReachability } from './server-reachability';

/**
 * Whether the gateway is answering, and what the app does about it while it is
 * not (plan 0008, sections 1 and 6).
 *
 * Fake timers throughout, which is what makes "ten probes over twenty minutes"
 * an assertion rather than a twenty minute test. `whenStable` hangs under them,
 * so the microtask queue is drained by hand wherever an assertion needs a
 * promise to have settled.
 *
 * The probe is a double rather than an `HttpTestingController`, because what is
 * under test here is the state machine and not the request. `HealthApi` has its
 * own spec for the request.
 */

const INTERVAL = DEFAULT_REACHABILITY_POLICY.retryIntervalMs;
const ATTEMPTS = DEFAULT_REACHABILITY_POLICY.maxAutomaticAttempts;

/** What the server did, per test, and how many times it was asked. */
const control = { reachable: true, probes: 0, hold: false };

let release: ((reachable: boolean) => void) | null = null;

const health: HealthServiceI = {
  probe: async () => {
    control.probes += 1;
    if (control.hold) {
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    }
    return control.reachable;
  },
};

async function drain(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await drain();
}

/** What `document.visibilityState` answers, which jsdom leaves read only. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('ServerReachability', () => {
  let reachability: ServerReachability;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-04T09:00:00.000Z'));
    control.reachable = true;
    control.probes = 0;
    control.hold = false;
    release = null;

    TestBed.configureTestingModule({
      providers: [
        { provide: HEALTH_SERVICE, useValue: health },
        {
          provide: ADMIN_REACHABILITY_POLICY,
          useValue: DEFAULT_REACHABILITY_POLICY,
        },
        ServerReachability,
      ],
    });

    reachability = TestBed.inject(ServerReachability);
  });

  afterEach(() => {
    reachability.stop();
    jest.useRealTimers();
  });

  /** Nothing has failed. An app that has established nothing draws itself. */
  it('starts up saying nothing is wrong', () => {
    expect(reachability.down()).toBe(false);
    expect(control.probes).toBe(0);
  });

  it('stays up when the probe answers', async () => {
    await reachability.check();

    expect(reachability.down()).toBe(false);
    expect(control.probes).toBe(1);
  });

  it('goes down when the probe does not', async () => {
    control.reachable = false;

    await reachability.check();

    expect(reachability.down()).toBe(true);
  });

  /**
   * The reason this is single flight. A screenful of requests that fail together
   * would otherwise be a probe each, against the server that just proved it
   * cannot answer them.
   */
  it('makes one probe for however many callers ask at once', async () => {
    control.hold = true;

    const answers = [
      reachability.check(),
      reachability.check(),
      reachability.check(),
    ];
    await drain();

    expect(control.probes).toBe(1);

    release?.(false);
    expect(await Promise.all(answers)).toEqual([false, false, false]);
  });

  it('is checking only while a probe is in flight', async () => {
    control.hold = true;

    const answer = reachability.check();
    await drain();
    expect(reachability.checking()).toBe(true);

    release?.(true);
    await answer;
    expect(reachability.checking()).toBe(false);
  });

  describe('while it is down', () => {
    beforeEach(async () => {
      control.reachable = false;
      await reachability.check();
      control.probes = 0;
    });

    it('probes again on its own, at the stated interval', async () => {
      await advance(INTERVAL - 1);
      expect(control.probes).toBe(0);

      await advance(1);
      expect(control.probes).toBe(1);
    });

    /**
     * Section 6. Twenty minutes of asking, and then the button is the only thing
     * that asks. The alternative is a tab left open overnight, probing a dead
     * host until the laptop is closed.
     */
    it('stops after the tenth automatic probe', async () => {
      for (let i = 0; i < ATTEMPTS + 3; i += 1) {
        await advance(INTERVAL);
      }

      expect(control.probes).toBe(ATTEMPTS);
      expect(reachability.exhausted()).toBe(true);
      expect(reachability.down()).toBe(true);
    });

    it('counts down the probes it has left', async () => {
      expect(reachability.automaticAttemptsLeft()).toBe(ATTEMPTS);

      await advance(INTERVAL);

      expect(reachability.automaticAttemptsLeft()).toBe(ATTEMPTS - 1);
    });

    it('still probes on request once the automatic ones are spent', async () => {
      for (let i = 0; i < ATTEMPTS; i += 1) {
        await advance(INTERVAL);
      }
      control.probes = 0;

      await reachability.retry();

      expect(control.probes).toBe(1);
    });

    /** A press one second before an automatic probe is not two probes. */
    it('restarts the wait when the button is pressed', async () => {
      await advance(INTERVAL - 1_000);
      control.probes = 0;

      await reachability.retry();
      expect(control.probes).toBe(1);

      await advance(INTERVAL - 1);
      expect(control.probes).toBe(1);

      await advance(1);
      expect(control.probes).toBe(2);
    });

    it('comes back up when a probe answers, and stops probing', async () => {
      control.reachable = true;

      await reachability.retry();

      expect(reachability.down()).toBe(false);
      expect(reachability.automaticAttemptsLeft()).toBe(ATTEMPTS);

      control.probes = 0;
      await advance(INTERVAL * 3);
      expect(control.probes).toBe(0);
    });

    /**
     * A page hidden for an hour must not cost the operator two more minutes to
     * learn that the server came back.
     */
    it('probes when the tab becomes visible again', async () => {
      reachability.start();
      setVisibility('hidden');
      // Spend the automatic budget, then let an interval pass with nothing
      // asking. The guard below is against a probe that just happened, so a
      // test that came back before one had is asserting the other rule.
      for (let i = 0; i < ATTEMPTS; i += 1) {
        await advance(INTERVAL);
      }
      await advance(INTERVAL);
      control.probes = 0;

      setVisibility('visible');
      await drain();

      expect(control.probes).toBe(1);
    });

    /** The guard against a window manager that flaps. */
    it('ignores a tab that becomes visible right after a probe', async () => {
      reachability.start();
      control.probes = 0;

      setVisibility('hidden');
      setVisibility('visible');
      await drain();

      expect(control.probes).toBe(0);
    });
  });

  it('does nothing about a visible tab while the server is answering', async () => {
    reachability.start();
    await advance(INTERVAL * 5);
    control.probes = 0;

    setVisibility('visible');
    await drain();

    expect(control.probes).toBe(0);
  });
});
