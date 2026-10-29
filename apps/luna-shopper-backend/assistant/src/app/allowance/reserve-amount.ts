import { MODERATION_PROMPT } from '../assistant/moderation';
import type { AssistantConfig } from '../config/app-config';
import {
  CLAUDE_MAX_TOKENS,
  MODERATION_MAX_TOKENS,
} from '../provider/claude.provider';
import { priceRowFor, type PriceRow } from '../provider/prices';

/**
 * The input of one model call of a turn, in tokens (plan 0234, section 5.2):
 * the figure of plan 0224 section 10, about 4,300 cached and 2,100 fresh
 * tokens a turn. It is a measured average and not a cap, which is why the
 * worst case below prices all of it as fresh input. A turn with a full
 * transcript and six large tool results can send more; the settle then charges
 * what it really cost, and only this one turn runs past its reservation.
 */
export const TURN_INPUT_TOKENS_PER_CALL = 6_400;

/**
 * The longest message a person can type, in characters: the gateway's
 * `AssistantTurnDto` refuses a longer one. Counted here as that many tokens,
 * which overcounts, because a token is about four characters.
 */
export const TURN_MESSAGE_MAX_CHARS = 2_000;

/** The worst case of one turn, call by call, in integer micro dollars. */
export interface WorstTurn {
  /** One call to begin with, plus one per tool round. */
  calls: number;
  perCallMicroUsd: number;
  /** The check of the reply after the turn (plan 0236), zero when it is off. */
  moderationMicroUsd: number;
  totalMicroUsd: number;
}

function priced(row: PriceRow, input: number, output: number): number {
  return Math.ceil(
    (input * row.inputMicroUsdPerMTok + output * row.outputMicroUsdPerMTok) /
      1_000_000
  );
}

/**
 * The worst turn of section 5.2, recomputed from the caps and the price
 * table, so a cap or a price that moves fails `reserve-amount.spec.ts`
 * instead of drifting.
 *
 * Seven calls at the default caps: one, plus `ASSISTANT_MAX_TOOL_CALLS` of
 * six. Each writes at most `CLAUDE_MAX_TOKENS` and reads
 * {@link TURN_INPUT_TOKENS_PER_CALL}, all priced as fresh input. The moderation
 * call reads its prompt, the message and the reply, each counted as one token
 * per character or at its ceiling, and writes at most `MODERATION_MAX_TOKENS`.
 * A spoken turn reserves the same: the transcriber is ours, and a
 * transcription costs no money (plan 0235).
 */
export function worstTurn(
  config: Pick<
    AssistantConfig,
    'model' | 'moderationModel' | 'moderation' | 'maxToolCalls'
  >
): WorstTurn {
  const calls = 1 + config.maxToolCalls;
  const perCallMicroUsd = priced(
    priceRowFor(config.model),
    TURN_INPUT_TOKENS_PER_CALL,
    CLAUDE_MAX_TOKENS
  );
  const moderationMicroUsd = config.moderation
    ? priced(
        priceRowFor(config.moderationModel),
        MODERATION_PROMPT.length + TURN_MESSAGE_MAX_CHARS + CLAUDE_MAX_TOKENS,
        MODERATION_MAX_TOKENS
      )
    : 0;
  return {
    calls,
    perCallMicroUsd,
    moderationMicroUsd,
    totalMicroUsd: calls * perCallMicroUsd + moderationMicroUsd,
  };
}
