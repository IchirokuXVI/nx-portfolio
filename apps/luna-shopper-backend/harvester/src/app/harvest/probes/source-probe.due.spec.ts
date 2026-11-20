import { SourceProbeStatus } from '@portfolio/luna-shopper/contracts';
import {
  PROBE_INTERVAL_MS,
  PROBE_RETRY_MS,
  probeDueAttempt,
  readProbeIntervalHours,
  type NewestProbe,
} from './source-probe.due';

/**
 * The due rule of a probe (plan 0219, section 7, as the owner decided it on
 * 2026-11-06): a per chain interval, and two retries of an UNREACHABLE probe.
 */
describe('the due rule of a probe', () => {
  const NOW = new Date('2026-11-06T10:00:00.000Z');
  const minutesAgo = (minutes: number) =>
    new Date(NOW.getTime() - minutes * 60_000);
  const newest = (
    status: SourceProbeStatus,
    minutes: number,
    attempt = 1
  ): NewestProbe => ({ status, attempt, startedAt: minutesAgo(minutes) });
  const PASSED = SourceProbeStatus.PASSED;
  const UNREACHABLE = SourceProbeStatus.UNREACHABLE;

  describe('the interval', () => {
    it('is 24 hours with no value, and with a value it cannot read', () => {
      expect(PROBE_INTERVAL_MS).toBe(86_400_000);
      expect(readProbeIntervalHours({})).toBe(24);
      expect(readProbeIntervalHours(null)).toBe(24);
      expect(readProbeIntervalHours({ probeIntervalHours: '6' })).toBe(24);
      expect(readProbeIntervalHours({ probeIntervalHours: 1.5 })).toBe(24);
      expect(readProbeIntervalHours({ probeIntervalHours: -1 })).toBe(24);
      expect(readProbeIntervalHours({ probeIntervalHours: 6 })).toBe(6);
    });

    it('with no value is not due 23 hours after a probe, and is after 25', () => {
      expect(probeDueAttempt({}, newest(PASSED, 23 * 60), NOW)).toBeNull();
      expect(probeDueAttempt({}, newest(PASSED, 25 * 60), NOW)).toBe(1);
    });

    it('is due with no probe at all', () => {
      expect(probeDueAttempt({}, null, NOW)).toBe(1);
    });

    it('with probeIntervalHours 1 is due 2 hours after a probe', () => {
      expect(
        probeDueAttempt({ probeIntervalHours: 1 }, newest(PASSED, 120), NOW)
      ).toBe(1);
      expect(
        probeDueAttempt({ probeIntervalHours: 1 }, newest(PASSED, 50), NOW)
      ).toBeNull();
    });

    it('with probeIntervalHours 0 is never due, not even with no probe or after an UNREACHABLE', () => {
      const off = { probeIntervalHours: 0 };
      expect(probeDueAttempt(off, null, NOW)).toBeNull();
      expect(
        probeDueAttempt(off, newest(PASSED, 100 * 24 * 60), NOW)
      ).toBeNull();
      expect(probeDueAttempt(off, newest(UNREACHABLE, 60), NOW)).toBeNull();
    });
  });

  describe('the retry of an UNREACHABLE probe', () => {
    it('is 30 minutes', () => {
      expect(PROBE_RETRY_MS).toBe(30 * 60_000);
    });

    it('makes attempt 1 due after 31 minutes and not after 29, as attempt 2', () => {
      expect(probeDueAttempt({}, newest(UNREACHABLE, 29, 1), NOW)).toBeNull();
      expect(probeDueAttempt({}, newest(UNREACHABLE, 31, 1), NOW)).toBe(2);
    });

    it('makes attempt 2 into attempt 3', () => {
      expect(probeDueAttempt({}, newest(UNREACHABLE, 31, 2), NOW)).toBe(3);
    });

    it('stops at attempt 3, which waits for the interval from itself', () => {
      expect(probeDueAttempt({}, newest(UNREACHABLE, 31, 3), NOW)).toBeNull();
      expect(probeDueAttempt({}, newest(UNREACHABLE, 25 * 60, 3), NOW)).toBe(1);
    });

    it('retries whatever the interval says', () => {
      expect(
        probeDueAttempt(
          { probeIntervalHours: 168 },
          newest(UNREACHABLE, 31, 1),
          NOW
        )
      ).toBe(2);
    });

    it('ends with any other status, so the next probe is attempt 1', () => {
      expect(probeDueAttempt({}, newest(PASSED, 25 * 60, 2), NOW)).toBe(1);
      expect(
        probeDueAttempt({}, newest(SourceProbeStatus.BLOCKED, 31, 1), NOW)
      ).toBeNull();
    });
  });
});
