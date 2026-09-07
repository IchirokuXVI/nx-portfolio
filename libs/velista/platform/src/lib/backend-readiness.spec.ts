import { TestBed } from '@angular/core/testing';
import { BackendReadiness, STARTUP_SLOW_AFTER_MS } from './backend-readiness';
import { ConnectionState } from './connection-state';
import { provideFakeBrowserFacade } from './testing/velista-testing';

describe('BackendReadiness', () => {
  let readiness: BackendReadiness;

  function build(): void {
    TestBed.configureTestingModule({
      providers: [provideFakeBrowserFacade()],
    });
    readiness = TestBed.inject(BackendReadiness);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    build();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts connecting, unsettled and not slow', () => {
    expect(readiness.state()).toBe('connecting');
    expect(readiness.settledAt()).toBeNull();
    expect(readiness.slow()).toBe(false);
  });

  describe('the transitions in section 3', () => {
    it('goes to ready on a 2xx', () => {
      readiness.reportReady();

      expect(readiness.state()).toBe('ready');
      expect(readiness.settledAt()).not.toBeNull();
    });

    it('goes to too-old on a client_too_old refusal', () => {
      readiness.reportTooOld();

      expect(readiness.state()).toBe('too-old');
    });

    it('goes to unreachable on no response or any other status', () => {
      readiness.reportUnreachable();

      expect(readiness.state()).toBe('unreachable');
    });

    it('recovers from unreachable when a later probe answers', () => {
      readiness.reportUnreachable();

      readiness.reportReady();

      expect(readiness.state()).toBe('ready');
    });

    it('leaves ready for unreachable when the connection is lost later', () => {
      readiness.reportReady();

      TestBed.inject(ConnectionState).reportNetworkFailure();
      TestBed.tick();

      expect(readiness.state()).toBe('unreachable');
    });

    // Terminal within a document: the way out is a new bundle and a reload, which is
    // `0072`'s subject, not another probe.
    it('stays too-old whatever answers afterwards', () => {
      readiness.reportTooOld();

      readiness.reportReady();
      readiness.reportUnreachable();

      expect(readiness.state()).toBe('too-old');
    });
  });

  describe('slow()', () => {
    it('turns true once the wait passes with the app still unusable', () => {
      jest.advanceTimersByTime(STARTUP_SLOW_AFTER_MS - 1);
      expect(readiness.slow()).toBe(false);

      jest.advanceTimersByTime(1);
      expect(readiness.slow()).toBe(true);
    });

    // The whole point of D8: one timer, from the app starting, so the escape text is
    // not pushed away by every retry.
    it('is not restarted by an attempt that answered and failed', () => {
      jest.advanceTimersByTime(2_000);
      readiness.reportUnreachable();

      jest.advanceTimersByTime(1_000);

      expect(readiness.slow()).toBe(true);
    });

    it('never fires once the backend answered', () => {
      readiness.reportReady();

      jest.advanceTimersByTime(STARTUP_SLOW_AFTER_MS * 2);

      expect(readiness.slow()).toBe(false);
    });

    it('fires once and stays put', () => {
      jest.advanceTimersByTime(STARTUP_SLOW_AFTER_MS * 3);

      expect(readiness.slow()).toBe(true);
    });
  });

  describe('retryRequested()', () => {
    // A counter and not a boolean: a request to retry is an edge, and a probe that
    // read a latched boolean could not tell a second press from the first.
    it('counts rather than latching', () => {
      expect(readiness.retryRequested()).toBe(0);

      readiness.requestRetry();
      expect(readiness.retryRequested()).toBe(1);

      readiness.requestRetry();
      expect(readiness.retryRequested()).toBe(2);
    });
  });

  it('records the first answer only, whatever came after it', () => {
    readiness.reportUnreachable();
    const first = readiness.settledAt();

    jest.advanceTimersByTime(5_000);
    readiness.reportReady();

    expect(readiness.settledAt()).toBe(first);
  });
});
