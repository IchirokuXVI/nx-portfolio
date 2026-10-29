import {
  DEFAULT_ALLOWANCE,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_MODERATION_MODEL,
} from '../config/app-config';
import { CLAUDE_MAX_TOKENS } from '../provider/claude.provider';
import { TURN_INPUT_TOKENS_PER_CALL, worstTurn } from './reserve-amount';

/**
 * The worst turn of plan 0234 section 5.2, recomputed from the caps and the
 * price table. A cap or a price that moves fails here instead of drifting
 * past the reserve.
 */
describe('the worst turn', () => {
  const shipped = {
    model: DEFAULT_CLAUDE_MODEL,
    moderationModel: DEFAULT_MODERATION_MODEL,
    moderation: true,
    // ASSISTANT_MAX_TOOL_CALLS, as app-config defaults it.
    maxToolCalls: 6,
  };

  it('fits inside the default turn reserve', () => {
    const worst = worstTurn(shipped);

    expect(worst.calls).toBe(7);
    // 6,400 input at $0.10 and 4,096 output at $0.50 per million.
    expect(worst.perCallMicroUsd).toBe(
      Math.ceil(
        (TURN_INPUT_TOKENS_PER_CALL * 100_000 + CLAUDE_MAX_TOKENS * 500_000) /
          1_000_000
      )
    );
    expect(worst.perCallMicroUsd).toBe(2688);
    expect(worst.totalMicroUsd).toBe(7 * 2688 + worst.moderationMicroUsd);
    expect(worst.totalMicroUsd).toBeLessThanOrEqual(
      DEFAULT_ALLOWANCE.turnReserveMicroUsd
    );
  });

  it('counts the moderation call only when it runs', () => {
    expect(worstTurn(shipped).moderationMicroUsd).toBeGreaterThan(0);
    expect(
      worstTurn({ ...shipped, moderation: false }).moderationMicroUsd
    ).toBe(0);
  });

  it('grows with the caps and the model, so a move shows here', () => {
    expect(
      worstTurn({ ...shipped, maxToolCalls: 8 }).totalMicroUsd
    ).toBeGreaterThan(DEFAULT_ALLOWANCE.turnReserveMicroUsd);
    expect(
      worstTurn({ ...shipped, model: 'claude-sonnet-5-5' }).totalMicroUsd
    ).toBeGreaterThan(DEFAULT_ALLOWANCE.turnReserveMicroUsd);
  });
});
