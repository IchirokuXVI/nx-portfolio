#!/usr/bin/env node
/**
 * The orchestrator a person runs (plan 0001).
 *
 * This is the one entry point of the curation toolchain that is meant to be
 * invoked by hand. It picks the implementation, takes a fresh rehearsal slot,
 * drives the decider's next/model/decide loop with one model call per row, and
 * tears the slot down whatever happened.
 *
 * The rehearsal slot is ephemeral: this checkout is not configured for it, and
 * whatever slot you are serving here keeps running throughout. See `slots.mjs`.
 *
 *   node libs/luna-shopper/curation-cli/src/cli.mjs --implementation suggestions
 *   node libs/luna-shopper/curation-cli/src/cli.mjs --apply .curation-runs/<id>/decisions.jsonl
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
 *   3. node libs/luna-shopper/curation-cli/src/cli.mjs \
 *        --implementation suggestions --main-url http://localhost:3000 \
 *        --run-dir .curation-runs/smoke --chain <one supermarket id>
 *      Watch stderr: it names the slot, then the run id and the row count, then
 *      one `n/total - name` line per row. Stop it with Ctrl+C after a handful.
 *   4. bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
 *      The rehearsal slot is gone, and slot 0 is exactly as step 1 left it. A
 *      Ctrl+C skips the teardown, so a slot left behind here is taken down with
 *      `luna-slot.sh --ephemeral --down <the number step 3 named>`.
 *   5. head -3 .curation-runs/smoke/decisions.jsonl
 *      The header line, then one record per decided row.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { spawn as spawnProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMPLEMENTATION_NAMES, deciderPath, makeDecider } from './decider.mjs';
import {
  CLAUDE_TIMEOUT_MS,
  DEFAULT_MODEL,
  confirmApiBilling,
  emptyUsage,
  makeApiEngine,
  makeClaudeEngine,
  stripFence,
} from './engine.mjs';
import { runCuration } from './orchestrator.mjs';
import { REHEARSAL_SERVICES, makeSlots, waitForGateway } from './slots.mjs';

/** The workspace root, four directories above this file. */
export const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Where a run keeps its state when the operator names no directory. */
const DEFAULT_RUN_ROOT = '.curation-runs';

/** The main API a development run reads its queue from. */
const DEFAULT_MAIN_URL = 'http://localhost:3000';

const USAGE = `Usage: node cli.mjs [options]

  --implementation <suggestions|groups>  which decider to drive; asked when the
                                         terminal can be asked and it is absent
  --engine <claude|api>                  claude (default) bills your Claude
                                         session; api bills ANTHROPIC_API_KEY
                                         and asks before it does
  --model <name>                         default ${DEFAULT_MODEL}
  --run-dir <dir>                        default ${DEFAULT_RUN_ROOT}/<timestamp>
  --main-url <u>                         default ${DEFAULT_MAIN_URL}
  --main-user <name>                     default dev-admin
  --main-password <p>                    default dev-admin-password, which is
                                         what every slot seeds
  --chain <supermarket id>               work one chain only (suggestions)
  --services <a,b>                       rehearsal services, default
                                         ${REHEARSAL_SERVICES.join(',')}
  --apply <decisions.jsonl>              replay a decisions file into the main
                                         gateway: no slot, no model
`;

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
  { input, env, cwd, timeoutMs } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timer = null;

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
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }
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

export async function main(
  argv,
  {
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    isTty = Boolean(process.stdin.isTTY),
    spawn = spawnCapture,
    ask = askLine,
    repoRoot = REPO_ROOT,
    platform = process.platform,
  } = {}
) {
  const flags = parseArgs(argv);
  if (flags.help) {
    stdout.write(USAGE);
    return 0;
  }

  const mainUrl =
    typeof flags['main-url'] === 'string'
      ? flags['main-url']
      : DEFAULT_MAIN_URL;
  const mainUser =
    typeof flags['main-user'] === 'string' ? flags['main-user'] : null;
  const mainPassword =
    typeof flags['main-password'] === 'string' ? flags['main-password'] : null;
  const model = typeof flags.model === 'string' ? flags.model : DEFAULT_MODEL;

  // A misspelled engine is refused before a slot is taken or a directory made.
  const engineName = typeof flags.engine === 'string' ? flags.engine : 'claude';
  if (engineName !== 'claude' && engineName !== 'api') {
    throw new Error(`Unknown engine ${engineName}. It is claude or api.`);
  }

  const implementation = await resolveImplementation({
    flag: flags.implementation,
    isTty,
    askLine: ask,
    stdout,
  });
  const cliPath = deciderPath(implementation, repoRoot);

  // `--apply` skips all of it: no slot, no model, one request.
  if (typeof flags.apply === 'string') {
    const decider = makeDecider({
      spawn,
      cliPath,
      runDir: null,
      mainPassword,
    });
    const answer = await decider.apply({
      mainUrl,
      file: flags.apply,
      mainUser,
    });
    stdout.write(`${JSON.stringify(answer)}\n`);
    return 0;
  }

  const runDir =
    typeof flags['run-dir'] === 'string' ? flags['run-dir'] : defaultRunDir();
  mkdirSync(runDir, { recursive: true });

  const usage = emptyUsage();
  let engine;
  if (engineName === 'claude') {
    engine = makeClaudeEngine({
      spawn,
      env,
      model,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      stderr,
      usage,
    });
  } else if (engineName === 'api') {
    const apiKey = await confirmApiBilling({
      env,
      isTty,
      askLine: ask,
      stdout,
    });
    engine = makeApiEngine({ apiKey, model, usage });
  }

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

  await runCuration({
    slots,
    makeDeciderFor: ({ runDir: dir }) =>
      makeDecider({ spawn, cliPath, runDir: dir, mainPassword }),
    engine,
    runDir,
    mainUrl,
    mainUser,
    model,
    chain: typeof flags.chain === 'string' ? flags.chain : null,
    services,
    waitForGateway,
    stripFence,
    stdout,
    stderr,
    dumpPath: `${runDir}/rehearsal-catalog.sql`,
    usage,
  });

  return 0;
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
