#!/usr/bin/env node
/**
 * The orchestrator a person runs (plan 0001).
 *
 * This is the one entry point of the curation toolchain that is meant to be
 * invoked by hand. It picks the implementation, takes a fresh rehearsal slot,
 * drives the decider's next/model/decide loop as many rows at a time as the
 * engine and the decider between them allow, and tears the slot down whatever
 * happened.
 *
 * The rehearsal slot is ephemeral: this checkout is not configured for it, and
 * whatever slot you are serving here keeps running throughout. See `slots.mjs`.
 *
 *   npx nx run luna-shopper/curation-cli:curate -- --implementation suggestions
 *   npx nx run luna-shopper/curation-cli:curate -- --resume .curation-runs/<id>
 *   npx nx run luna-shopper/curation-cli:curate -- --apply .curation-runs/<id>/decisions.jsonl
 *
 * `README.md` beside `src` walks the whole flow, from the first run to the
 * apply, with one example per decider.
 *
 * Keep the `--`. Nx reads the flags in front of it as its own, and `--verbose`
 * is one of them, so a flag typed without the `--` is dropped in silence.
 *
 * THE MANUAL SMOKE RUN, against slot 0 as the main API.
 *
 * The automated tests inject every process and every socket, so nothing in them
 * proves the real `luna-slot`, the real decider and the real `claude` agree.
 * That is this procedure, and it is run by hand:
 *
 *   1. bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up 0
 *      Slot 0 is the main API for the smoke run: the queue is read from it and
 *      nothing is ever written to it before `--apply`.
 *   2. bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
 *      Note which slot the run will take, so the next step can be recognized.
 *   3. npx nx run luna-shopper/curation-cli:curate -- \
 *        --implementation suggestions --main-url http://localhost:3000 \
 *        --run-dir .curation-runs/smoke --chain <one supermarket id>
 *      Watch stderr: it names the slot, then the run id and the row count, then
 *      one `n/total - name` line per row. Stop it with Ctrl+C after a handful:
 *      the row in flight is dropped, the report is written over the rows that
 *      were decided, the summary names the command that resumes the run, and
 *      the slot comes down. A second Ctrl+C stops the process at once and
 *      names the slot it is leaving up.
 *   4. bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
 *      The rehearsal slot is gone, and slot 0 is exactly as step 1 left it. A
 *      slot left behind by the second Ctrl+C is taken down with
 *      `luna-slot.sh --ephemeral --down <the number step 3 named>`.
 *   5. head -3 .curation-runs/smoke/decisions.jsonl
 *      The header line, then one record per decided row, and
 *      `report.json` beside it whether the run finished or was stopped.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { spawn as spawnProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_ENGINE,
  ENGINES,
  ENGINE_NAMES,
  emptyUsage,
  engineEntry,
  stripFence,
} from '../../../../../shared/model-engines/src/index.mjs';
import {
  DEFAULT_ADMIN_USERNAME,
  createAdminSession,
} from '../../auth/src/session.mjs';
import { applyDecisions, splitDecisions } from './apply.mjs';
import {
  exportChanges,
  foldChanges,
  parseActors,
  parseSlot,
  parseTime,
  readChangeList,
} from './changes.mjs';
import { IMPLEMENTATION_NAMES, deciderPath, makeDecider } from './decider.mjs';
import { runCuration } from './orchestrator.mjs';
import {
  assertConfirmedHost,
  assertReportTarget,
  capturingFetch,
  defaultReportPath,
  makeTargetClient,
  normalizeTargetUrl,
  parseBatchSize,
  prepareDecisions,
  runReplay,
  runReplayIdentity,
} from './replay.mjs';
import {
  RUN_FILE,
  readDecisions,
  readRunFile,
  recordRowFailure,
  replayCreations,
  runFileBeside,
  sniffImplementation,
  writeRunFile,
} from './run-files.mjs';
import { REHEARSAL_SERVICES, makeSlots, waitForGateway } from './slots.mjs';

/** The workspace root, six directories above this file. */
export const REPO_ROOT = fileURLToPath(
  new URL('../../../../../..', import.meta.url)
);

/** Where a run keeps its state when the operator names no directory. */
const DEFAULT_RUN_ROOT = '.curation-runs';

/** The main API a development run reads its queue from. */
const DEFAULT_MAIN_URL = 'http://localhost:3000';

/** Where a help line's description starts. */
const HELP_COLUMN = 41;

/**
 * Where a replay reads its password when stdin is not a terminal (owner
 * decision O7): set for the one command, never typed as a flag.
 */
export const REPLAY_PASSWORD_ENV = 'CURATION_TARGET_PASSWORD';

/**
 * The help text, with the engine half read off the registry.
 *
 * `ENGINE_NAMES` drives both this and the argument check below, so an adapter
 * added to the registry cannot leave either stale. The model and the effort
 * levels are named per engine because they are per engine: there is no one
 * default model, and a provider that has no effort levels says so here.
 */
export function usageText(engines = ENGINES) {
  const indent = ' '.repeat(HELP_COLUMN);
  const line = (flag, text) => `  ${flag}`.padEnd(HELP_COLUMN) + text;
  const width = Math.max(...engines.map((entry) => entry.name.length));
  const perEngine = engines
    .map((entry) => {
      const effort =
        entry.effortLevels.length > 0
          ? `effort ${entry.effortLevels.join('|')} (${entry.defaultEffort})`
          : 'no effort levels';
      return `    ${entry.name.padEnd(width)}  model ${entry.defaultModel}, ${effort}`;
    })
    .join('\n');

  return `Usage: npx nx run luna-shopper/curation-cli:curate -- [options]

  Keep the \`--\`. Nx reads what comes before it as its own flags, so an option
  typed without the \`--\` is dropped in silence.

${line('--implementation <suggestions|groups>', 'which decider to drive; asked when the')}
${indent}terminal can be asked and it is absent
${line(`--engine <${ENGINE_NAMES.join('|')}>`, `which provider answers, default ${DEFAULT_ENGINE}.`)}
${indent}claude bills your Claude session; api
${indent}bills ANTHROPIC_API_KEY and asks first
${line('--model <name>', "the engine's own default when absent")}
${line('--effort <level>', 'how hard the model thinks about one row')}

  Each engine names its own defaults, and the level in brackets is the one it
  takes when --effort is absent:

${perEngine}

${line('--run-dir <dir>', `default ${DEFAULT_RUN_ROOT}/<timestamp>`)}
${line('--main-url <u>', `default ${DEFAULT_MAIN_URL}`)}
${line('--main-user <name>', 'default dev-admin')}
${line('--main-password <p>', 'default dev-admin-password, which is')}
${indent}what every slot seeds
${line('--chain <supermarket id>', 'work one chain only (suggestions)')}
${line('--limit <n>', 'stop handing rows to the model after n')}
${indent}of them, then end the run normally
${line('--services <a,b>', 'rehearsal services, default')}
${indent}${REHEARSAL_SERVICES.join(',')}
${line('--resume <run-dir>', 'continue a stopped run on a new slot;')}
${indent}its decider, chain and main url are the
${indent}ones it was started with
${line('--apply <decisions.jsonl>', 'replay a decisions file into the main')}
${indent}gateway: no slot, no model. Reads the
${indent}decider from the run directory and the
${indent}main url from the file, and splits a
${indent}file over the route's cap by itself

  Carry local edits to a cluster (plan 0006):

${line('--export-changes <file>', "write one operator's product edits,")}
${indent}read from a local slot's catalog_audit
${line('  --slot <n>', 'the local slot that holds the edits')}
${line('  --actor <admin id>', 'whose edits; repeat it for several')}
${line('  --since <ISO time>', 'required; --until defaults to now')}
${line('--replay <changes.jsonl>', 'sort each change by what the target')}
${indent}holds; a dry run unless --write
${line('  --target-url <url>', 'required, no default, never from a file')}
${line('  --write', 'send the apply class through the items')}
${indent}batch, each edit under an expect
${line('  --confirm-host <host>', 'required with --write: the host name of')}
${indent}--target-url, typed a second time
${line('  --batch-size <n>', 'default 100, at most 1000')}
${line('  --report <file>', 'default beside the change list')}
${line('  --decisions <file>', 'also replay a suggestions decisions file')}
${line('--replay-identity <report>', "send a report's identity changed class,")}
${indent}guarded by the target's name and brand;
${indent}takes --target-url, --write, --confirm-host,
${indent}--report
${line('  --only <file>', 'one product id a line: only those;')}
${indent}required with --write

  A replay signs in as --main-user (default ${DEFAULT_ADMIN_USERNAME}). The password is
  asked at the terminal, or read from ${REPLAY_PASSWORD_ENV} when stdin is
  not one. It is never a flag.

  The ollama engine reads five environment variables: OLLAMA_HOST,
  OLLAMA_NUM_CTX, OLLAMA_NUM_PREDICT, OLLAMA_BATCH (how many requests are held
  in flight, default 4) and OLLAMA_ROUND (how many rows are fetched, asked and
  decided as one round, default three times OLLAMA_BATCH).

  OLLAMA_BATCH above 4 buys nothing on a single 4080 class card: six and eight
  in flight both measured slower than four, and what a higher value needs is
  the server's own OLLAMA_NUM_PARALLEL rather than this one. OLLAMA_ROUND is
  the lever for what is left. A round only as wide as the pool pays a tail
  every round, where the last request answers with every other slot idle and
  the walk then goes to the decider before anything is sent again, and a wider
  round pays that tail and that trip a third as often. It asks nothing more of
  the server.

  OLLAMA_BATCH only pays against a server configured to match it. Ollama
  answers OLLAMA_NUM_PARALLEL requests at a time and queues the rest, so a
  batch of four against a server running one slot is four requests run end to
  end, which is roughly the time of walking the rows one by one. Set
  OLLAMA_NUM_PARALLEL on the machine running Ollama, to OLLAMA_BATCH or
  higher. On Windows that is a user environment variable and then the Ollama
  tray app restarted, and the server prints OLLAMA_NUM_PARALLEL:<n> into
  %LOCALAPPDATA%\\Ollama\\server.log when it starts. Nothing in Ollama's API
  reports the running value, so a run that sees the first round answered one
  request at a time says so on stderr.
`;
}

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument ${token}`);
    }
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = value;
      i += 1;
    }
  }
  return flags;
}

/**
 * How many rows `--limit` asks for, or null when it asks for none.
 *
 * A short run over the front of a real queue is how the toolchain is measured
 * and how a prompt change is judged, and until this flag existed every harness
 * that wanted one capped the rows itself outside the CLI. `--limit` with no
 * value is a flag with nothing to limit to, so it is refused rather than read
 * as one row or as no limit at all.
 */
export function parseLimit(value) {
  if (value === undefined) {
    return null;
  }
  const rows = Number(String(value).trim());
  if (!Number.isInteger(rows) || rows < 1) {
    throw new Error(
      `--limit is ${value === true ? '(nothing)' : value}, and it has to be a whole number of rows, one or more.`
    );
  }
  return rows;
}

/**
 * What the model server said it spent, in one line, or null when it said
 * nothing (model-engines plan 0005).
 *
 * Wall clock says almost nothing on this machine. Two identical 80 row walks
 * measured 157 s and 207 s, about 30% apart, so a run that claims to be 20%
 * faster than the one before it has claimed nothing. These three numbers are
 * per call properties of the server rather than of the afternoon the run
 * happened in: decode throughput holds still while the wall clock wanders, the
 * prompt share says how much of the time went on reading rather than writing,
 * and a load time that grows through a run means the model is being unloaded
 * between rows and `keep_alive` is not holding it.
 *
 * One line, because two runs are compared by reading the same line twice, and
 * that stops being easy the moment it is a table. It is a pure function of the
 * usage and the engine's name, so the arithmetic is tested without a run, and
 * it answers null for every engine whose provider reports no durations, which
 * today is every engine but ollama.
 */
export function serverTimingsLine(usage, name) {
  const timings = usage?.timings;
  if (!timings || !(timings.calls > 0)) {
    return null;
  }
  const parts = [];
  if (timings.evalMs > 0) {
    const perSecond = timings.evalTokens / (timings.evalMs / 1000);
    parts.push(`${perSecond.toFixed(1)} decode tok/s`);
  }
  if (timings.totalMs > 0) {
    const share = Math.round((timings.promptEvalMs / timings.totalMs) * 100);
    parts.push(
      `prompt eval ${share}% of ${(timings.totalMs / 1000).toFixed(1)} s`
    );
  }
  parts.push(`load ${(timings.loadMs / 1000).toFixed(1)} s`);
  return `${name}: ${parts.join(', ')} over ${timings.calls} calls\n`;
}

/** A run directory nobody has to name, and no two runs share. */
export function defaultRunDir(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${DEFAULT_RUN_ROOT}/${stamp}`;
}

/**
 * Which decider to drive.
 *
 * A terminal is asked. A pipe is not, because a run that guesses the
 * implementation would rehearse the wrong domain for an hour.
 */
export async function resolveImplementation({ flag, isTty, askLine, stdout }) {
  if (typeof flag === 'string' && flag !== '') {
    if (!IMPLEMENTATION_NAMES.includes(flag)) {
      throw new Error(
        `Unknown implementation ${flag}. It is one of: ${IMPLEMENTATION_NAMES.join(', ')}.`
      );
    }
    return flag;
  }
  if (!isTty) {
    throw new Error(
      `--implementation is required: one of ${IMPLEMENTATION_NAMES.join(', ')}.`
    );
  }
  stdout.write(
    `Which decider should this run drive?\n  ${IMPLEMENTATION_NAMES.map((name, index) => `${index + 1}) ${name}`).join('\n  ')}\nAnswer with the name or the number: `
  );
  const answer = String(await askLine()).trim();
  const byNumber = IMPLEMENTATION_NAMES[Number(answer) - 1];
  const chosen = IMPLEMENTATION_NAMES.includes(answer) ? answer : byNumber;
  if (!chosen) {
    throw new Error(
      `${answer || '(nothing)'} is not one of the implementations.`
    );
  }
  return chosen;
}

/**
 * A child process, as everything in this library expects one.
 *
 * It answers rather than throws on a non-zero exit, because a decider's stderr
 * on a failed subcommand is the message the operator needs to see.
 */
export function spawnCapture(
  command,
  args,
  { input, env, cwd, timeoutMs, signal } = {}
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('the run was stopped'));
      return;
    }
    const child = spawnProcess(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timer = null;

    // A stopped run does not wait for the child it was in the middle of. The
    // child is killed rather than left running, because a `claude` call that
    // outlived the run would bill for a row nobody records.
    const onStop = () => {
      child.kill();
      reject(signal.reason ?? new Error('the run was stopped'));
    };
    signal?.addEventListener('abort', onStop, { once: true });
    const forget = () => signal?.removeEventListener('abort', onStop);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      forget();
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      forget();
      resolve({ code: code ?? 0, stdout, stderr });
    });

    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${command} did not answer within ${timeoutMs}ms`));
      }, timeoutMs);
    }

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * The decider, as one long lived child (plan 0002 of `curation-suggestions`).
 *
 * Unlike `spawnCapture` this answers the child itself rather than what it
 * printed, because the decider is now talked to over its pipes for the whole
 * run instead of being started again per step. `decider.mjs` asks it for three
 * streams, `on` and `kill`, and nothing else.
 */
export function spawnChild(command, args, { env, cwd } = {}) {
  return spawnProcess(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** One line from the terminal. */
function askLine() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.once('line', (line) => {
      rl.close();
      resolve(line);
    });
  });
}

/** The signals that stop a run: Ctrl+C, a `kill`, and a terminal that closed. */
export const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** The exit code a shell reads as "ended by this signal". */
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * Ctrl+C once stops the run, twice stops the process.
 *
 * SIGTERM and SIGHUP are the same request from somewhere else (plan 0005): a
 * `kill`, or the terminal window closing. Each of them used to end the process
 * where it stood, with the slot up and nothing recording its number. Now any
 * of the three stops the run, and a second one of any kind is the escape
 * hatch.
 *
 * The first one aborts the signal every step of the run holds: the model call
 * in flight is killed, the walk stops at that row, the decider writes the
 * report over the rows it did decide, and the rehearsal slot comes down. That
 * is the whole reason this exists. The default handling ends the process where
 * it stands, which left a run with no `report.json` and a slot still up.
 *
 * The second one is the escape hatch, for a teardown that is itself stuck. It
 * ends the process at once and names the slot it is abandoning, because the
 * slot was taken ephemerally: nothing recorded it, so nothing else can say
 * which number to take down.
 *
 * Everything it touches is injected, so the whole of it runs under `node
 * --test` without a signal being sent to the test process.
 */
export function installInterrupt({
  controller,
  stderr,
  on = (event, handler) => process.on(event, handler),
  off = (event, handler) => process.off(event, handler),
  exit = (code) => process.exit(code),
  slotOf = () => null,
}) {
  let asked = false;
  const handler = (signal = 'SIGINT') => {
    if (!asked) {
      asked = true;
      stderr.write(
        `\n${signal}: stopping. The row in flight is dropped, the report is written over the rows already decided, and the rehearsal slot comes down. Press Ctrl+C again to stop now.\n`
      );
      controller.abort(new Error(`the run was stopped with ${signal}`));
      return;
    }
    const slot = slotOf();
    stderr.write('\nstopping now: no report, and the slot is left running.\n');
    if (slot !== null) {
      stderr.write(
        `take it down with: bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down ${slot}\n`
      );
    }
    exit(SIGNAL_EXIT[signal] ?? 130);
  };
  for (const signal of STOP_SIGNALS) {
    on(signal, handler);
  }
  return () => {
    for (const signal of STOP_SIGNALS) {
      off(signal, handler);
    }
  };
}

/**
 * What a resumed run starts from (plan 0005).
 *
 * `curation-run.json` is written when a run opens, so a directory without one
 * was never opened by this orchestrator, or was opened before resuming existed.
 * Either way there is no prompt to walk the rest of it with.
 */
export function loadResume(runDir) {
  if (typeof runDir !== 'string' || runDir === '') {
    throw new Error('--resume takes the run directory of the run to continue.');
  }
  const stored = readRunFile(runDir);
  if (!stored) {
    throw new Error(
      `${join(runDir, RUN_FILE)} does not exist, so ${runDir} cannot be resumed. It is written when a run opens, and a run started before resuming existed has none. Start a new run.`
    );
  }
  if (!existsSync(join(runDir, 'state.json'))) {
    throw new Error(
      `${runDir} holds no state.json, so the run never opened. Start a new run.`
    );
  }
  return stored;
}

/** A flag's string value, or null when it was not given as one. */
function stringFlag(flags, name) {
  return typeof flags[name] === 'string' ? flags[name] : null;
}

/**
 * Every value a repeated flag was given, in order.
 *
 * `parseArgs` keeps the last one, which is right for every other flag. A flag
 * a person is told to repeat (`--actor`) reads all of them here instead.
 */
export function collectFlag(argv, name) {
  const values = [];
  argv.forEach((token, index) => {
    const value = argv[index + 1];
    if (
      token === `--${name}` &&
      value !== undefined &&
      !value.startsWith('--')
    ) {
      values.push(value);
    }
  });
  return values;
}

/**
 * One line from the terminal, with what is typed not echoed.
 *
 * The question goes to stderr, so a replay's stdout stays empty.
 */
function askSecretLine(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  let asked = false;
  rl._writeToOutput = (text) => {
    if (!asked) {
      process.stderr.write(text);
    }
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    asked = true;
  });
}

/**
 * The replay's password (owner decision O7): asked at a terminal, else read
 * from {@link REPLAY_PASSWORD_ENV}. Never a flag, and never printed.
 */
export async function resolveReplayPassword({
  isTty,
  env,
  askSecret,
  username,
  targetUrl,
}) {
  if (isTty) {
    const answer = String(
      await askSecret(`password for ${username} on ${targetUrl}: `)
    );
    if (answer === '') {
      throw new Error('No password was typed. Nothing was sent.');
    }
    return answer;
  }
  const fromEnv = env[REPLAY_PASSWORD_ENV];
  if (typeof fromEnv !== 'string' || fromEnv === '') {
    throw new Error(
      `stdin is not a terminal, so the password is read from ${REPLAY_PASSWORD_ENV}, and it is not set. Set it for this one command.`
    );
  }
  return fromEnv;
}

/** The product ids of an `--only` file, one a line. */
export function readOnlyIds(file, read = (path) => readFileSync(path, 'utf8')) {
  return read(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** The commit this CLI runs at, or null when git does not answer. */
async function commitOf(spawn, repoRoot) {
  try {
    const answer = await spawn('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    return answer.code === 0 ? answer.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * `--export-changes` (plan 0006, section 2). Reads a local slot and writes a
 * file; no gateway and no login.
 */
async function exportMode({ flags, argv, spawn, repoRoot, stderr }) {
  const file = flags['export-changes'];
  if (typeof file !== 'string') {
    throw new Error('--export-changes takes the change list file to write.');
  }
  const actors = parseActors(collectFlag(argv, 'actor'));
  const slot = parseSlot(flags.slot);
  const since =
    flags.since === undefined ? undefined : parseTime(flags.since, '--since');
  const until =
    flags.until === undefined ? undefined : parseTime(flags.until, '--until');
  mkdirSync(dirname(file), { recursive: true });
  await exportChanges({
    file,
    slot,
    actors,
    since,
    until,
    run: spawn,
    cwd: repoRoot,
    stderr,
  });
  return 0;
}

/**
 * `--replay` and `--replay-identity` (plan 0006, sections 3 to 6).
 *
 * Every flag is read and every file checked before the password is asked or a
 * request is sent, so a mistake costs nothing.
 */
async function replayMode({
  flags,
  env,
  stderr,
  isTty,
  askSecret,
  fetchImpl,
  spawn,
  repoRoot,
  sleep,
}) {
  if (flags['main-password'] !== undefined) {
    throw new Error(
      `A replay takes no password on the command line. It asks at the terminal, or reads ${REPLAY_PASSWORD_ENV} set for the one command.`
    );
  }
  const identityPass = flags['replay-identity'] !== undefined;
  const source = identityPass ? flags['replay-identity'] : flags.replay;
  if (typeof source !== 'string') {
    throw new Error(
      identityPass
        ? '--replay-identity takes the report of an earlier replay.'
        : '--replay takes the change list to replay.'
    );
  }
  if (!existsSync(source)) {
    throw new Error(`${source} does not exist.`);
  }
  const targetUrl = normalizeTargetUrl(stringFlag(flags, 'target-url'));
  const write = flags.write === true;
  // Owner decision 158a: a write names its host twice, and an identity write
  // names the products a person looked at. Both are refused here, before the
  // password is asked and before any request.
  if (write) {
    assertConfirmedHost(targetUrl, stringFlag(flags, 'confirm-host'));
    if (identityPass && stringFlag(flags, 'only') === null) {
      throw new Error(
        '--replay-identity --write needs --only <file>, the ids of the products you looked at, one a line. Nothing was sent.'
      );
    }
  }
  const batchSize = parseBatchSize(flags['batch-size']);
  const reportPath =
    stringFlag(flags, 'report') ??
    defaultReportPath(
      source,
      targetUrl,
      new Date(),
      identityPass ? 'replay-identity' : 'replay'
    );

  let plan;
  if (identityPass) {
    const previous = JSON.parse(readFileSync(source, 'utf8'));
    assertReportTarget(source, previous, targetUrl);
    const onlyFile = stringFlag(flags, 'only');
    plan = { previous, only: onlyFile ? readOnlyIds(onlyFile) : null };
  } else {
    const changeList = readChangeList(source);
    const folded = foldChanges(changeList);
    let decisions = null;
    const decisionsFile = stringFlag(flags, 'decisions');
    if (flags.decisions !== undefined && decisionsFile === null) {
      throw new Error('--decisions takes the decisions file to replay.');
    }
    if (decisionsFile !== null) {
      if (!existsSync(decisionsFile)) {
        throw new Error(`${decisionsFile} does not exist.`);
      }
      const { header, records } = readDecisions(decisionsFile);
      const implementation =
        runFileBeside(decisionsFile)?.implementation ??
        sniffImplementation(records);
      decisions = {
        file: decisionsFile,
        prepared: prepareDecisions({
          file: decisionsFile,
          header,
          records,
          implementation,
        }),
      };
    }
    plan = { changeList, folded, decisions };
  }

  const username = stringFlag(flags, 'main-user') ?? DEFAULT_ADMIN_USERNAME;
  const password = await resolveReplayPassword({
    isTty,
    env,
    askSecret,
    username,
    targetUrl,
  });
  const capture = capturingFetch(fetchImpl);
  const session = createAdminSession({
    baseUrl: targetUrl,
    username,
    password,
    fetchImpl: capture.fetchImpl,
    label: 'target',
  });
  await session.verify();
  const client = makeTargetClient({
    session,
    capture,
    stderr,
    ...(sleep ? { sleep } : {}),
  });
  const commit = await commitOf(spawn, repoRoot);
  mkdirSync(dirname(reportPath), { recursive: true });
  stderr.write(
    `${write ? 'write run' : 'dry run'} against ${targetUrl} as ${username}\n`
  );

  if (identityPass) {
    await runReplayIdentity({
      reportFile: source,
      previous: plan.previous,
      targetUrl,
      only: plan.only,
      write,
      batchSize,
      reportPath,
      client,
      stderr,
      commit,
    });
    return 0;
  }

  let decisions = null;
  if (plan.decisions) {
    const suggestions = await import('../../suggestions/src/commands.mjs');
    decisions = {
      ...plan.decisions,
      splitParts: (records) =>
        splitDecisions({
          records,
          buildOperations: suggestions.buildOperations,
          max: suggestions.MAX_OPERATIONS,
        }),
      applyFile: (path) =>
        suggestions.apply({
          mainUrl: null,
          targetUrl,
          file: path,
          session: { fetch: (route, init) => client.request(route, init) },
        }),
    };
  }
  await runReplay({
    changeFile: source,
    changeList: plan.changeList,
    folded: plan.folded,
    targetUrl,
    write,
    batchSize,
    reportPath,
    client,
    decisions,
    stderr,
    commit,
  });
  return 0;
}

export async function main(
  argv,
  {
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    isTty = Boolean(process.stdin.isTTY),
    spawn = spawnCapture,
    startChild = spawnChild,
    ask = askLine,
    repoRoot = REPO_ROOT,
    platform = process.platform,
    interrupt = installInterrupt,
    askSecret = askSecretLine,
    fetchImpl = globalThis.fetch,
    sleep = null,
  } = {}
) {
  const flags = parseArgs(argv);
  if (flags.help) {
    stdout.write(usageText());
    return 0;
  }

  // Plan 0006. Neither mode takes a slot of its own, a model or a decider.
  if (flags['export-changes'] !== undefined) {
    return exportMode({ flags, argv, spawn, repoRoot, stderr });
  }
  if (flags.replay !== undefined || flags['replay-identity'] !== undefined) {
    return replayMode({
      flags,
      env,
      stderr,
      isTty,
      askSecret,
      fetchImpl,
      spawn,
      repoRoot,
      sleep,
    });
  }

  const mainUser = stringFlag(flags, 'main-user');
  const mainPassword = stringFlag(flags, 'main-password');

  // `--apply` skips all of it: no slot, no model, one request per part. The
  // implementation is read from the run directory and the main url from the
  // file's header (plan 0005), so neither flag is needed. `apply` closes each
  // decider itself, so there is nothing to tear down here.
  if (flags.apply !== undefined) {
    if (typeof flags.apply !== 'string') {
      throw new Error('--apply takes the decisions file to replay.');
    }
    const named = stringFlag(flags, 'implementation');
    if (named !== null) {
      deciderPath(named, repoRoot);
    }
    await applyDecisions({
      file: flags.apply,
      implementation: named,
      mainUrl: stringFlag(flags, 'main-url'),
      mainUser,
      passwordGiven: mainPassword !== null,
      makeDeciderFor: (implementation) =>
        makeDecider({
          startChild,
          cliPath: deciderPath(implementation, repoRoot),
          runDir: null,
          mainPassword,
        }),
      stdout,
      stderr,
    });
    return 0;
  }

  // A resumed run is the run it was, so everything it was started with comes
  // from its own file, and a flag only overrides what may differ between two
  // sittings: the engine, the model, the effort and the limit.
  const resumed = flags.resume === undefined ? null : loadResume(flags.resume);
  if (resumed && flags['run-dir'] !== undefined) {
    throw new Error(
      '--resume names the run directory already. Leave out --run-dir.'
    );
  }
  const refuseChange = (name, given, stored) => {
    if (resumed && given !== null && given !== (stored ?? null)) {
      throw new Error(
        `${flags.resume} was started with --${name} ${stored ?? '(none)'}, and a resumed run keeps it. Leave out --${name}.`
      );
    }
  };
  refuseChange(
    'implementation',
    stringFlag(flags, 'implementation'),
    resumed?.implementation
  );
  refuseChange('main-url', stringFlag(flags, 'main-url'), resumed?.mainUrl);
  refuseChange('chain', stringFlag(flags, 'chain'), resumed?.chain);

  const mainUrl =
    resumed?.mainUrl ?? stringFlag(flags, 'main-url') ?? DEFAULT_MAIN_URL;
  const runUser = mainUser ?? resumed?.mainUser ?? null;

  // A misspelled engine is refused before a slot is taken or a directory made,
  // and the entry it resolves to is what answers for the model and the effort.
  // Nothing here asks which engine it got.
  const engineName =
    stringFlag(flags, 'engine') ?? resumed?.engine ?? DEFAULT_ENGINE;
  const entry = engineEntry(engineName);
  // What the resumed run was started with belongs to the engine it was
  // started on, so another engine takes its own defaults.
  const sameEngine = resumed?.engine === entry.name;

  const model =
    stringFlag(flags, 'model') ??
    (sameEngine ? resumed.model : null) ??
    entry.defaultModel;

  // Refused here rather than by the CLI three layers down, where it would cost
  // a slot, a login and a rehearsal catalog before it said so. The levels are
  // the resolved entry's own: a provider with none refuses the flag outright.
  const effort =
    stringFlag(flags, 'effort') ??
    (sameEngine ? resumed.effort : null) ??
    entry.defaultEffort;
  if (effort !== null && !entry.effortLevels.includes(effort)) {
    throw new Error(
      entry.effortLevels.length > 0
        ? `Unknown effort ${effort}. It is one of ${entry.effortLevels.join(', ')}.`
        : `The ${entry.name} engine takes no --effort.`
    );
  }

  // Refused here, before a slot is taken and a rehearsal catalog is built, for
  // the same reason a misspelled engine is: a flag that cannot be read is a run
  // that was never going to do what was asked of it.
  const limit =
    flags.limit === undefined
      ? (resumed?.limit ?? null)
      : parseLimit(flags.limit);

  const implementation =
    resumed?.implementation ??
    (await resolveImplementation({
      flag: flags.implementation,
      isTty,
      askLine: ask,
      stdout,
    }));
  const cliPath = deciderPath(implementation, repoRoot);
  const chain = resumed ? (resumed.chain ?? null) : stringFlag(flags, 'chain');
  // The groups decider refuses --chain itself, because a product group spans
  // every chain. Refused here as well, before a slot is taken, for the same
  // reason a misspelled engine is.
  if (implementation === 'groups' && chain !== null) {
    throw new Error(
      '--chain works with the suggestions decider only. A product group spans every chain, so a groups walk is every ungrouped product. Run it without --chain.'
    );
  }

  const runDir = resumed
    ? flags.resume
    : (stringFlag(flags, 'run-dir') ?? defaultRunDir());
  mkdirSync(runDir, { recursive: true });

  // One controller for the whole run: the engine, the wait for the gateway and
  // the walk all hold this signal, so one Ctrl+C reaches whichever of them is
  // in flight. The handler itself goes on further down, once the questions are
  // asked: a Ctrl+C at a prompt is an answer of "not this run", and the default
  // handling of it is the right one.
  const controller = new AbortController();
  let slot = null;

  const usage = emptyUsage();
  // The gate is whatever this entry needs confirmed before it runs, and its
  // answer is what builds the engine. An entry with no gate is asked nothing.
  const gated = entry.gate
    ? await entry.gate({ env, isTty, askLine: ask, stdout })
    : null;
  const engine = entry.create({
    spawn,
    env,
    model,
    effort,
    usage,
    stderr,
    gated,
    signal: controller.signal,
  });

  const slots = makeSlots({
    run: spawn,
    repoRoot,
    platform,
    writeFile: (path, text) => writeFileSync(path, text),
  });

  const services =
    typeof flags.services === 'string'
      ? flags.services
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      : REHEARSAL_SERVICES;

  const releaseInterrupt = interrupt({
    controller,
    stderr,
    slotOf: () => slot,
  });

  // The decider is one child for the whole run now, and the orchestrator never
  // disposes of what `makeDeciderFor` built: it asks for a decider and drives
  // it. So the one that was built is held here and closed in the `finally`
  // below, which is the only place that sees a run end whichever way it ended.
  // `end` closes it too, and `close` is idempotent, so the two cannot fight.
  let decider = null;

  let outcome;
  try {
    outcome = await runCuration({
      slots,
      makeDeciderFor: ({ runDir: dir }) => {
        decider = makeDecider({
          startChild,
          cliPath,
          runDir: dir,
          mainPassword,
        });
        return decider;
      },
      engine,
      runDir,
      mainUrl,
      mainUser: runUser,
      model,
      // The registry is the authority about engines, so the walk asks the entry
      // rather than the name (plan 0003).
      local: entry.local === true,
      chain,
      limit,
      services,
      waitForGateway,
      stripFence,
      stdout,
      stderr,
      dumpPath: `${runDir}/rehearsal-catalog.sql`,
      usage,
      signal: controller.signal,
      onSlot: (taken) => {
        slot = taken;
      },
      // Everything a resume needs and the decider does not keep: which decider
      // ran, on what, and what `start` answered. Never the password.
      onOpened: (opened) =>
        writeRunFile(runDir, {
          implementation,
          engine: entry.name,
          model,
          effort,
          chain,
          limit,
          mainUrl,
          mainUser: runUser,
          opened,
        }),
      resume: resumed
        ? {
            opened: resumed.opened,
            replay: ({ rehearsalUrl }) =>
              replayCreations({ implementation, runDir, rehearsalUrl }),
          }
        : null,
      recordRowFailure: ({ row, error }) =>
        recordRowFailure({ implementation, runDir, row, error }),
      readReport: (path) => JSON.parse(readFileSync(path, 'utf8')),
      passwordGiven: mainPassword !== null,
    });
  } finally {
    // The listener is what keeps the process alive after the run, so it is
    // taken off whether the run ended, failed or was stopped.
    releaseInterrupt();
    // Written here rather than after the run so that a run which was stopped or
    // which failed still reports what the rows it did reach cost. A run that
    // made no timed call at all has nothing to say and says nothing.
    //
    // Before the close below, because the line is what the operator reads and
    // the close is teardown that is allowed to take a couple of seconds.
    const line = serverTimingsLine(usage, engine.name);
    if (line) {
      stderr.write(line);
    }
    // A run that failed or was stopped never reached `end`, so its decider is
    // still holding a child. A child whose stdin is still open is another
    // reason this process would not exit.
    await decider?.close();
  }

  // A stopped run wrote its report, and it is still not a finished run: 130 is
  // what a shell reads as "ended by Ctrl+C".
  return outcome?.stopped ? 130 : 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.message ?? error}\n`);
      process.exitCode = 1;
    }
  );
}
