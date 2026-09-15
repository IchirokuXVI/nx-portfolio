/**
 * One way to ask a model (plan 0001).
 *
 * Everything else in the workspace holds an engine and calls one method on it:
 *
 *   engine.ask(prompt, { system, schema, images }) -> { text }
 *
 * A caller holding several questions that do not depend on each other asks them
 * together instead (plan 0003), and reads the answers either at the end or as
 * each one arrives (plan 0004):
 *
 *   engine.askMany(prompts, { system, schema, images })
 *     -> Array<{ text } | { error }>
 *   engine.askEach(prompts, { system, schema, images })
 *     -> Array<Promise<{ text } | { error }>>
 *   engine.batchSize   // how many requests are held in flight, 1 means one
 *   engine.roundSize   // how many prompts a caller is advised to send at once
 *
 * Both answer in input order, one entry per prompt, and a prompt the engine
 * gave up on is reported in its own entry while the rest still answer. A stop
 * is different from a failure: it rejects the whole of `askMany` with the
 * signal's own reason, and every `askEach` promise that has not settled. The
 * promises `askEach` hands back are safe to abandon half way through, because
 * each of them is given a handler when it is made.
 *
 * `batchSize` and `roundSize` are two numbers because they answer two
 * questions. The first is bounded by the server or the account behind the
 * engine. The second is bounded by nothing there, and a round wider than the
 * pool is what keeps the pool full while the caller works on an answer. Every
 * adapter reports both, so no caller has to ask which one it is holding.
 *
 * `prompt` is the user half and `system` is the standing half, and the two are
 * never joined by the caller, because an adapter that can cache the standing
 * half separately must be free to do it. `schema` is a JSON schema the reply
 * must fit, or null, and how it is enforced is the adapter's business. Parsing
 * the answer is the caller's business, because the shape belongs to whoever
 * wrote the prompt. `engine.name`, `engine.model` and `engine.effort` are
 * readable, because the run reports what answered it.
 *
 * **`images`** is a page the model can see (plan 0004, a page the model can
 * see): an array of `{ mediaType, data }`, empty or absent by default, where
 * `data` is base64 and never a file path. The media type is one of
 * `SUPPORTED_IMAGE_MEDIA_TYPES`, and anything else is refused here before a
 * request is made, with an error named `IMAGE_ERROR_NAME`. Like `system`, it
 * belongs to the whole call: in `askMany` and `askEach` the same pictures reach
 * every prompt, and a caller with a different picture per question calls `ask`
 * per question. Whether the model can see at all is a property of the model
 * rather than of a registry entry, so asking a text only model to read a page
 * is a provider error the operator should read as written.
 *
 * **Usage** is accumulated into the `usage` object an adapter is built with:
 * the five token counters of `emptyUsage`, and beside them an optional
 * `timings` block of sums, which a provider that measures itself fills in
 * (plan 0005). Ollama is the only one that does today, and it is the only one
 * whose `ask` answers `{ text, timings }` rather than `{ text }`. See
 * `usage.mjs` for the field names and the two rates they are there to compute.
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
  imagePromptLine,
  imageToolArgs,
  makeClaudeEngine,
  makeScratchDir,
  readClaudeEnvelope,
  writeImages,
} from './claude-cli.mjs';
export {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
} from './claude-models.mjs';
export {
  IMAGE_ERROR_NAME,
  IMAGE_EXTENSIONS,
  ImageInputError,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  checkImages,
} from './images.mjs';
export {
  API_CONFIRMATION,
  confirmApiBilling,
  makeApiEngine,
  textOf,
  userContent,
} from './messages-api.mjs';
export {
  CHARACTERS_PER_TOKEN,
  KEEP_ALIVE,
  NUM_CTX_CEILING,
  OLLAMA_DEFAULT_BATCH,
  OLLAMA_DEFAULT_HOST,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_ROUND_MULTIPLIER,
  OLLAMA_MAX_BATCH,
  OLLAMA_WIDEST_MEASURED_BATCH,
  makeOllamaEngine,
  modelContextLength,
  ollamaBatchSize,
  ollamaHost,
  ollamaRoundSize,
  replyTimings,
  truncationFloor,
  wideBatchNotice,
} from './ollama.mjs';
export {
  DEFAULT_ENGINE,
  ENGINES,
  ENGINE_NAMES,
  engineEntry,
} from './registry.mjs';
export {
  RETRY_DELAYS,
  askEachInOrder,
  askEntry,
  askManyInOrder,
  handleAbandoned,
  stopReason,
  withRetries,
} from './retry.mjs';
export { stripFence } from './text.mjs';
export { addUsage, emptyUsage } from './usage.mjs';
