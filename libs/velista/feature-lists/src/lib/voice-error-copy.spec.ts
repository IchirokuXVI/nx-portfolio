import { GatewayError, NetworkError } from '@portfolio/velista/data-access';
import type { ErrorCode } from '@portfolio/velista/models';
import { voiceFailureCopy } from './voice-error-copy';

function gateway(
  code: ErrorCode,
  status: number,
  retryAfterSeconds?: number
): GatewayError {
  return new GatewayError({
    code,
    status,
    correlationId: 'cid-1',
    retryAfterSeconds,
  });
}

/**
 * The one property every case here is really about: a sentence claiming the list did
 * not change is only allowed where this client knows the list did not change.
 */
describe('voiceFailureCopy', () => {
  describe('nothing was added, and the page knows it', () => {
    it('says so for a request that never reached the server', () => {
      expect(voiceFailureCopy(new NetworkError('cid-1', 'assistant'))).toEqual({
        messageKey: 'list.add.voiceFailed',
      });
    });

    it('says so for anything that is not a gateway failure at all', () => {
      expect(voiceFailureCopy(new Error('boom'))).toEqual({
        messageKey: 'list.add.voiceFailed',
      });
    });

    it.each<[ErrorCode, number]>([
      ['validation_failed', 400],
      ['unauthorized', 401],
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
    ])('says so for a %s, which is refused at the door', (code, status) => {
      expect(voiceFailureCopy(gateway(code, status))).toEqual({
        messageKey: 'list.add.voiceFailed',
      });
    });
  });

  describe('a bucket that refused the request', () => {
    it('counts the server’s own seconds down', () => {
      expect(voiceFailureCopy(gateway('rate_limited', 429, 12))).toEqual({
        messageKey: 'list.add.voiceBusy',
        messageArgs: { count: 12 },
      });
    });

    it('shows no clock when the server named no number (rule C3)', () => {
      expect(voiceFailureCopy(gateway('rate_limited', 429))).toEqual({
        messageKey: 'list.add.voiceBusyNoNumber',
      });
    });
  });

  it('does not tell somebody to try again where trying again cannot work', () => {
    // 501: this deployment has no model provider (backend plan 0026).
    expect(voiceFailureCopy(gateway('not_configured', 501))).toEqual({
      messageKey: 'list.add.voiceUnavailable',
    });
  });

  describe('an outcome this client cannot know', () => {
    // The regression this file exists for. A turn that reached the assistant may have
    // written lines already, and a proxy giving up on one that is still running writes
    // them seconds after the strip has spoken. "Nothing was added" was the claim the
    // page had no basis for, and repeating the sentence is how somebody got two of
    // everything.
    it.each([500, 502, 503, 504])(
      'asks for the list to be checked (%s)',
      (status) => {
        expect(voiceFailureCopy(gateway('internal', status))).toEqual({
          messageKey: 'list.add.voiceUnsure',
        });
      }
    );

    it('never claims nothing was added', () => {
      expect(voiceFailureCopy(gateway('internal', 504)).messageKey).not.toBe(
        'list.add.voiceFailed'
      );
    });
  });

  /**
   * Velista `0174`, target 6. The allowance refused before a turn ran, so nothing was
   * added, and the sentence says when the assistant is back rather than "try again".
   */
  describe('the allowance said no', () => {
    function allowance(details: Record<string, unknown>): GatewayError {
      return new GatewayError({
        code: 'assistant_allowance_reached',
        status: 429,
        correlationId: 'cid-1',
        details,
      });
    }

    // Local parts, so the expected time holds in whatever zone the run is in.
    const nine = new Date(2026, 9, 29, 21, 0).toISOString();
    const one = new Date(2026, 9, 30, 1, 0).toISOString();
    const november = new Date(2026, 10, 1, 0, 0).toISOString();

    it("names the person's day and the time it is back", () => {
      expect(
        voiceFailureCopy(
          allowance({
            scope: 'user',
            period: 'day',
            limit: 'turns',
            resetsAt: nine,
          }),
          'es'
        )
      ).toEqual({
        messageKey: 'list.add.allowance.usedDay.at',
        messageArgs: { time: '21:00', count: 21 },
      });
    });

    it('passes the hour that picks the Spanish article', () => {
      expect(
        voiceFailureCopy(
          allowance({ scope: 'user', period: 'day', resetsAt: one }),
          'es'
        ).messageArgs
      ).toEqual({ time: '1:00', count: 1 });
    });

    it('names a date for a month', () => {
      expect(
        voiceFailureCopy(
          allowance({
            scope: 'user',
            period: 'month',
            limit: 'cost',
            resetsAt: november,
          }),
          'es'
        )
      ).toEqual({
        messageKey: 'list.add.allowance.usedMonth.on',
        messageArgs: { date: '1 de noviembre' },
      });
    });

    it('speaks of speaking after the audio limit', () => {
      expect(
        voiceFailureCopy(
          allowance({
            scope: 'user',
            period: 'day',
            limit: 'assistantAudio',
            resetsAt: nine,
          }),
          'en'
        ).messageKey
      ).toBe('list.add.allowance.speakingDay.at');
    });

    it("says the assistant is resting when it is the deployment's", () => {
      expect(
        voiceFailureCopy(
          allowance({
            scope: 'deployment',
            period: 'day',
            limit: 'cost',
            resetsAt: nine,
          }),
          'en'
        ).messageKey
      ).toBe('list.add.allowance.resting.at');
      expect(
        voiceFailureCopy(
          allowance({
            scope: 'deployment',
            period: 'month',
            limit: 'cost',
            resetsAt: november,
          }),
          'en'
        ).messageKey
      ).toBe('list.add.allowance.resting.on');
    });

    it('leaves the time out when it could not be read', () => {
      expect(
        voiceFailureCopy(allowance({ scope: 'user', period: 'day' }), 'en')
      ).toEqual({ messageKey: 'list.add.allowance.usedDay.plain' });
    });

    it('never counts down and never says try again', () => {
      const copy = voiceFailureCopy(
        allowance({ scope: 'user', period: 'day', resetsAt: nine }),
        'en'
      );

      expect(copy.messageKey).not.toMatch(/voiceBusy|voiceFailed|voiceUnsure/);
      expect(copy.messageArgs).not.toHaveProperty('seconds');
    });
  });
});
