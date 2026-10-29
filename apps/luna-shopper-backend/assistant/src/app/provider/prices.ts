import type { ModelUsage } from './model-provider';

/**
 * What a model costs, per million tokens, in integer micro dollars (plan 0234,
 * section 2.2).
 *
 * One dollar per million tokens is one micro dollar per token, so a row reads
 * as the vendor's price list with six zeros: Haiku's $0.10 input is 100,000
 * micro dollars per million tokens. Integers all the way, so no amount of money
 * is ever a float, in a computation or in a log.
 */
export interface PriceRow {
  model: string;
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
  cacheReadMicroUsdPerMTok: number;
  /** The day the row was read from the vendor's price list. */
  asOf: string;
}

/**
 * The price table (plan 0234, section 2.2). It starts with the Claude rows of
 * plan 0226 section 2.3, checked again on 2026-10-29 against the price list
 * the build read (the `claude-api` reference, cached 2026-10-06), which moved
 * one number: Sonnet 5.5 reads its cache at $0.20, not $0.10. Opus 5.5 and
 * Fable 5.1 are here although no cluster runs them, so that an operator who
 * sets one in `ASSISTANT_MODEL` is priced at its own row and not at a cheaper
 * one.
 *
 * Haiku 5.5 bills a prompt above 100,000 tokens at five times these rates. No
 * turn reaches that: the transcript is capped at 8,000 characters and the
 * catalog and the system prompt are a few thousand tokens more.
 *
 * Cache writes are not priced, because the provider seam does not report them
 * (`ModelUsage` has no field for `cache_creation_input_tokens`, and this plan
 * does not change the provider classes). Section 15 of the plan names the gap.
 *
 * When plan 0226 is built, this becomes a read of its model rows and the
 * formula below stays.
 */
export const PRICE_TABLE: readonly PriceRow[] = [
  {
    model: 'claude-haiku-5-5',
    inputMicroUsdPerMTok: 100_000,
    outputMicroUsdPerMTok: 500_000,
    cacheReadMicroUsdPerMTok: 10_000,
    asOf: '2026-10-29',
  },
  {
    model: 'claude-sonnet-5-5',
    inputMicroUsdPerMTok: 2_000_000,
    outputMicroUsdPerMTok: 10_000_000,
    cacheReadMicroUsdPerMTok: 200_000,
    asOf: '2026-10-29',
  },
  {
    model: 'claude-opus-5-5',
    inputMicroUsdPerMTok: 4_000_000,
    outputMicroUsdPerMTok: 20_000_000,
    cacheReadMicroUsdPerMTok: 200_000,
    asOf: '2026-10-29',
  },
  {
    model: 'claude-fable-5-1',
    inputMicroUsdPerMTok: 10_000_000,
    outputMicroUsdPerMTok: 50_000_000,
    cacheReadMicroUsdPerMTok: 250_000,
    asOf: '2026-10-29',
  },
];

/** The dearest row, by output price, which an unknown model is priced at. */
export const DEAREST_ROW: PriceRow = PRICE_TABLE.reduce((dearest, row) =>
  row.outputMicroUsdPerMTok > dearest.outputMicroUsdPerMTok ? row : dearest
);

/**
 * The row of `model`, or the dearest row when the table has none: counting
 * too much is the safe error (plan 0234, constraints). The boot log names a
 * configured model that has no row.
 */
export function priceRowFor(model: string): PriceRow {
  return PRICE_TABLE.find((row) => row.model === model) ?? DEAREST_ROW;
}

/** Whether `model` has a row of its own. */
export function hasPriceRow(model: string): boolean {
  return PRICE_TABLE.some((row) => row.model === model);
}

/**
 * `prompt * in + cached * cacheRead + response * out`, per million tokens, in
 * micro dollars, rounded up (section 2.2).
 *
 * `promptTokens` is what the provider billed as fresh input. Claude reports it
 * that way: `input_tokens` excludes the tokens read from the cache, which
 * arrive apart as `cache_read_input_tokens`. So the formula's "uncached
 * prompt" is `promptTokens` itself, never `promptTokens - cachedPromptTokens`.
 *
 * Answers `null` when the provider reported no usage or left a count unknown,
 * which the caller charges as the reservation in full.
 */
export function costMicroUsd(
  model: string,
  usage: ModelUsage | null | undefined
): number | null {
  if (!usage || usage.promptTokens === null || usage.responseTokens === null) {
    return null;
  }
  const row = priceRowFor(model);
  const cached = usage.cachedPromptTokens ?? 0;
  const perMillion =
    usage.promptTokens * row.inputMicroUsdPerMTok +
    cached * row.cacheReadMicroUsdPerMTok +
    usage.responseTokens * row.outputMicroUsdPerMTok;
  return Math.ceil(perMillion / 1_000_000);
}
