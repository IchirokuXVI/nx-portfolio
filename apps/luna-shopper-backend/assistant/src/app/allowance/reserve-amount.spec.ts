import {
  DEFAULT_ALLOWANCE,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_MODERATION_MODEL,
} from '../config/app-config';
import { CLAUDE_MAX_TOKENS } from '../provider/claude.provider';
import { priceRowFor } from '../provider/prices';
import {
  TURN_INPUT_TOKENS_PER_CALL,
  worstOutputAtTypicalInput,
} from './reserve-amount';

/**
 * The worst output at the typical input, plan 0234 section 5.2, recomputed
 * from the caps and the price table. A cap or a price that moves fails here
 * instead of drifting past the reserve.
 *
 * It proves that every call at its output ceiling fits the reserve when each
 * reads the typical input. It does not prove a cap on a turn: the input is a
 * measured average, and the settle charges what a turn really cost.
 */
const shipped = {
  model: DEFAULT_CLAUDE_MODEL,
  moderationModel: DEFAULT_MODERATION_MODEL,
  moderation: true,
  // ASSISTANT_MAX_TOOL_CALLS, as app-config defaults it.
  maxToolCalls: 6,
};

/**
 * Informational, asserted only to be finite: the same turn when call `k`
 * also reads the outputs of the `k` calls before it again, which is how a tool
 * loop grows its input. About 28,239 micro dollars at the Haiku row
 * (130,816 input and 28,672 output tokens, plus the moderation call), above
 * the 20,000 default reserve. Raising the reserve is the owner's call
 * (section 15, item 2).
 */
function withGrowingInput(): number {
  const worst = worstOutputAtTypicalInput(shipped);
  const row = priceRowFor(shipped.model);
  let input = 0;
  for (let k = 0; k < worst.calls; k += 1) {
    input += TURN_INPUT_TOKENS_PER_CALL + k * CLAUDE_MAX_TOKENS;
  }
  const output = worst.calls * CLAUDE_MAX_TOKENS;
  return (
    Math.ceil(
      (input * row.inputMicroUsdPerMTok + output * row.outputMicroUsdPerMTok) /
        1_000_000
    ) + worst.moderationMicroUsd
  );
}

describe('the worst output at the typical input', () => {
  it('fits the default turn reserve', () => {
    const worst = worstOutputAtTypicalInput(shipped);

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

  it(`with the earlier outputs read again as input, reaches ${withGrowingInput()} micro dollars (informational)`, () => {
    expect(Number.isFinite(withGrowingInput())).toBe(true);
  });

  it('counts the moderation call only when it runs', () => {
    expect(
      worstOutputAtTypicalInput(shipped).moderationMicroUsd
    ).toBeGreaterThan(0);
    expect(
      worstOutputAtTypicalInput({ ...shipped, moderation: false })
        .moderationMicroUsd
    ).toBe(0);
  });

  it('grows with the caps and the model, so a move shows here', () => {
    expect(
      worstOutputAtTypicalInput({ ...shipped, maxToolCalls: 8 }).totalMicroUsd
    ).toBeGreaterThan(DEFAULT_ALLOWANCE.turnReserveMicroUsd);
    expect(
      worstOutputAtTypicalInput({ ...shipped, model: 'claude-sonnet-5-5' })
        .totalMicroUsd
    ).toBeGreaterThan(DEFAULT_ALLOWANCE.turnReserveMicroUsd);
  });
});
