import { GatewayError, NetworkError } from '../errors';
import { allowanceRefusal } from './allowance-refusal';

function refused(
  code: ConstructorParameters<typeof GatewayError>[0]['code'],
  details?: Record<string, unknown>
): GatewayError {
  return new GatewayError({ code, status: 429, correlationId: 'c1', details });
}

describe('allowanceRefusal (velista 0174)', () => {
  it('reads the four details the backend sends', () => {
    expect(
      allowanceRefusal(
        refused('assistant_allowance_reached', {
          scope: 'deployment',
          period: 'month',
          limit: 'cost',
          resetsAt: '2026-11-01T00:00:00+01:00',
        })
      )
    ).toEqual({
      scope: 'deployment',
      period: 'month',
      limit: 'cost',
      resetsAt: new Date('2026-10-31T23:00:00Z'),
    });
  });

  it('reads every limit by name', () => {
    for (const limit of ['turns', 'assistantAudio', 'commentAudio', 'cost']) {
      expect(
        allowanceRefusal(refused('assistant_allowance_reached', { limit }))
          ?.limit
      ).toBe(limit);
    }
  });

  it('reads an unknown value as the one that promises least', () => {
    expect(
      allowanceRefusal(
        refused('assistant_allowance_reached', {
          scope: 'galaxy',
          period: 'year',
          limit: 'tokens',
          resetsAt: 'tomorrow',
        })
      )
    ).toEqual({
      scope: 'user',
      period: 'day',
      limit: 'turns',
      resetsAt: null,
    });
  });

  it('reads a refusal with no details at all', () => {
    expect(allowanceRefusal(refused('assistant_allowance_reached'))).toEqual({
      scope: 'user',
      period: 'day',
      limit: 'turns',
      resetsAt: null,
    });
    expect(
      allowanceRefusal(
        refused('assistant_allowance_reached', { resetsAt: 1761696000000 })
      )?.resetsAt
    ).toBeNull();
  });

  it('answers null for every other failure', () => {
    expect(allowanceRefusal(refused('rate_limited'))).toBeNull();
    expect(allowanceRefusal(refused('not_configured'))).toBeNull();
    expect(
      allowanceRefusal(new NetworkError('c2', 'assistant.turn'))
    ).toBeNull();
    expect(allowanceRefusal(new Error('boom'))).toBeNull();
    expect(allowanceRefusal(undefined)).toBeNull();
  });
});
