/**
 * One way to ask a model (plan 0001).
 *
 * Everything else in the workspace holds an engine and calls one method on it:
 *
 *   engine.ask(prompt, { system, schema }) -> { text }
 *
 * `prompt` is the user half and `system` is the standing half, and the two are
 * never joined by the caller, because an adapter that can cache the standing
 * half separately must be free to do it. `schema` is a JSON schema the reply
 * must fit, or null, and how it is enforced is the adapter's business. Parsing
 * the answer is the caller's business, because the shape belongs to whoever
 * wrote the prompt. `engine.name`, `engine.model` and `engine.effort` are
 * readable, because the run reports what answered it.
 *
 * **What an adapter never holds**: a gateway URL, a token, a slot number, a row
 * count, or anything else about the run.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

export {
  CLAUDE_TIMEOUT_MS,
  MINIMAL_ARGS,
  TOOL_SHAPE_HINT,
  claudeChildEnv,
  makeClaudeEngine,
  makeScratchDir,
  readClaudeEnvelope,
} from './claude-cli.mjs';
export {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
} from './claude-models.mjs';
export {
  API_CONFIRMATION,
  confirmApiBilling,
  makeApiEngine,
  textOf,
} from './messages-api.mjs';
export {
  CHARACTERS_PER_TOKEN,
  KEEP_ALIVE,
  NUM_CTX_CEILING,
  OLLAMA_DEFAULT_HOST,
  OLLAMA_DEFAULT_MODEL,
  makeOllamaEngine,
  modelContextLength,
  ollamaHost,
  truncationFloor,
} from './ollama.mjs';
export {
  DEFAULT_ENGINE,
  ENGINES,
  ENGINE_NAMES,
  engineEntry,
} from './registry.mjs';
export { RETRY_DELAYS, stopReason, withRetries } from './retry.mjs';
export { stripFence } from './text.mjs';
export { addUsage, emptyUsage } from './usage.mjs';
