/**
 * What the two Claude adapters answer for (plan 0001).
 *
 * These are Claude facts and they sit here rather than in the registry,
 * because the registry states them per entry and an entry for a provider that
 * has neither a Claude model nor an effort level must be able to say so
 * without reading anything in this file.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/** The model both Claude adapters default to. */
export const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * How hard that model thinks about one row, on both Claude adapters.
 *
 * The api engine has always sent `output_config.effort`, and the claude engine
 * sent nothing, so the same `--model claude-sonnet-5` run reasoned differently
 * depending on which engine drove it. `--effort` is the CLI's own flag for it
 * and takes the same five words the API does, so one constant now answers for
 * both.
 *
 * `medium` is the level the deciders are written for. A curation row is one
 * lookup table applied to one packet: the rules are stated, the candidates are
 * in front of the model, and the work is reading them carefully rather than
 * exploring. `low` is where sonnet 5 starts skipping stated steps, and `high`
 * buys thinking tokens a decision this bounded does not spend.
 */
export const DEFAULT_EFFORT = 'medium';

/** The five levels `claude --effort` and `output_config.effort` both take. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
