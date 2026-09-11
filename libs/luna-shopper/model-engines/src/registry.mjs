/**
 * The one table `--engine <name>` reads (plan 0001).
 *
 * An entry is the whole of what a provider is, so adding one is a new adapter
 * file and a new row here. Nothing above this library may ask
 * `if (name === 'api')` again: it asks the entry.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { CLAUDE_TIMEOUT_MS, makeClaudeEngine } from './claude-cli.mjs';
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
} from './claude-models.mjs';
import { confirmApiBilling, makeApiEngine } from './messages-api.mjs';
import { OLLAMA_DEFAULT_MODEL, makeOllamaEngine } from './ollama.mjs';

/**
 * The providers, in the order a help text lists them.
 *
 * Each entry carries:
 *
 * - `name`, which is what `--engine` takes;
 * - `defaultModel` and `defaultEffort`, per entry rather than shared, because
 *   `claude-sonnet-5` is not a sensible default for a model running on the
 *   operator's own machine and one global constant would make it one;
 * - `effortLevels`, the levels this provider accepts, because effort is a
 *   Claude idea. An entry that takes no effort says so with an empty list;
 * - `gate`, the confirmation this entry needs before it runs, or null. It is
 *   asked before anything is built, and whatever it answers reaches `create`
 *   as `gated`;
 * - `create`, which builds the engine from the injected `spawn`, `fetch`,
 *   `env`, usage total and signal, so the whole library runs under
 *   `node --test` with no network and no `claude` installed.
 */
export const ENGINES = [
  {
    name: 'claude',
    defaultModel: DEFAULT_MODEL,
    defaultEffort: DEFAULT_EFFORT,
    effortLevels: EFFORT_LEVELS,
    // Nothing to confirm: the run bills the session the operator is already
    // logged in to, which is the billing they chose when they installed it.
    gate: null,
    create: ({
      spawn,
      env,
      model,
      effort,
      usage = null,
      stderr = process.stderr,
      signal = null,
    }) =>
      makeClaudeEngine({
        spawn,
        env,
        model,
        effort,
        timeoutMs: CLAUDE_TIMEOUT_MS,
        stderr,
        usage,
        signal,
      }),
  },
  {
    name: 'api',
    defaultModel: DEFAULT_MODEL,
    defaultEffort: DEFAULT_EFFORT,
    effortLevels: EFFORT_LEVELS,
    gate: confirmApiBilling,
    create: ({
      fetchImpl,
      model,
      effort,
      usage = null,
      signal = null,
      gated,
    }) =>
      makeApiEngine({
        ...(fetchImpl ? { fetchImpl } : {}),
        apiKey: gated,
        model,
        effort,
        usage,
        signal,
      }),
  },
  {
    name: 'ollama',
    // Not a Claude model, which is the point of stating it per entry. Unlike
    // the Claude default it names something the operator must have pulled,
    // which is why a 404 from the server is fatal and names `ollama pull`.
    defaultModel: OLLAMA_DEFAULT_MODEL,
    // Effort is a Claude idea, so this entry has none and says so with an
    // empty list. `cli.mjs` answers `The ollama engine takes no --effort.`
    // from that emptiness, and the help text prints `no effort levels`.
    defaultEffort: null,
    effortLevels: [],
    // Nothing to confirm: there is no billing for a model running on the
    // operator's own machine.
    gate: null,
    create: ({
      fetchImpl,
      env,
      model,
      usage = null,
      stderr = process.stderr,
      signal = null,
    }) =>
      makeOllamaEngine({
        ...(fetchImpl ? { fetchImpl } : {}),
        env,
        model,
        usage,
        // The one line an `OLLAMA_BATCH` above the measured optimum writes goes
        // where the claude entry's ignored key notice goes, and is injectable
        // for the same reason: a test reads it rather than the terminal.
        stderr,
        signal,
      }),
  },
];

/** The names `--engine` accepts, which is also what the help text lists. */
export const ENGINE_NAMES = ENGINES.map((entry) => entry.name);

/** The engine a run takes when the operator names none. */
export const DEFAULT_ENGINE = 'claude';

/** `a`, `a or b`, `a, b or c`, so a refusal reads as a sentence. */
function listNames(names) {
  if (names.length < 2) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * The entry a name resolves to.
 *
 * A misspelled engine is refused here, before a slot is taken or a directory
 * made, and the refusal lists the names there are rather than describing them.
 */
export function engineEntry(name) {
  const entry = ENGINES.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(
      `Unknown engine ${name}. It is ${listNames(ENGINE_NAMES)}.`
    );
  }
  return entry;
}
