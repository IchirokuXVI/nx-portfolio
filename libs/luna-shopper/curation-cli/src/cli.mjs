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
 *      one `n/total - name` line per row. Stop it with Ctrl+C after a handful:
 *      the row in flight is dropped, the report is written over the rows that
 *      were decided, and the slot comes down. A second Ctrl+C stops the process
 *      at once and names the slot it is leaving up.
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
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_ENGINE,
  ENGINES,
  ENGINE_NAMES,
  emptyUsage,
  engineEntry,
  stripFence,
} from '../../model-engines/src/index.mjs';
import { IMPLEMENTATION_NAMES, deciderPath, makeDecider } from './decider.mjs';
import { runCuration } from './orchestrator.mjs';
import { REHEARSAL_SERVICES, makeSlots, waitForGateway } from './slots.mjs';

/** The workspace root, four directories above this file. */
export const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Where a run keeps its state when the operator names no directory. */
const DEFAULT_RUN_ROOT = '.curation-runs';

/** The main API a development run reads its queue from. */
const DEFAULT_MAIN_URL = 'http://localhost:3000';

/** Where a help line's description starts. */
const HELP_COLUMN = 41;

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

  return `Usage: node cli.mjs [options]

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
${line('--services <a,b>', 'rehearsal services, default')}
${indent}${REHEARSAL_SERVICES.join(',')}
${line('--apply <decisions.jsonl>', 'replay a decisions file into the main')}
${indent}gateway: no slot, no model
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

/**
 * Ctrl+C once stops the run, twice stops the process.
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
  const handler = () => {
    if (!asked) {
      asked = true;
      stderr.write(
        '\nstopping: the row in flight is dropped, the report is written over the rows already decided, and the rehearsal slot comes down. Press Ctrl+C again to stop now.\n'
      );
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      return;
    }
    const slot = slotOf();
    stderr.write('\nstopping now: no report, and the slot is left running.\n');
    if (slot !== null) {
      stderr.write(
        `take it down with: bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down ${slot}\n`
      );
    }
    exit(130);
  };
  on('SIGINT', handler);
  return () => off('SIGINT', handler);
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
    interrupt = installInterrupt,
  } = {}
) {
  const flags = parseArgs(argv);
  if (flags.help) {
    stdout.write(usageText());
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
  // A misspelled engine is refused before a slot is taken or a directory made,
  // and the entry it resolves to is what answers for the model and the effort.
  // Nothing here asks which engine it got.
  const engineName =
    typeof flags.engine === 'string' ? flags.engine : DEFAULT_ENGINE;
  const entry = engineEntry(engineName);

  const model =
    typeof flags.model === 'string' ? flags.model : entry.defaultModel;

  // Refused here rather than by the CLI three layers down, where it would cost
  // a slot, a login and a rehearsal catalog before it said so. The levels are
  // the resolved entry's own: a provider with none refuses the flag outright.
  const effort =
    typeof flags.effort === 'string' ? flags.effort : entry.defaultEffort;
  if (effort !== null && !entry.effortLevels.includes(effort)) {
    throw new Error(
      entry.effortLevels.length > 0
        ? `Unknown effort ${effort}. It is one of ${entry.effortLevels.join(', ')}.`
        : `The ${entry.name} engine takes no --effort.`
    );
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

  let outcome;
  try {
    outcome = await runCuration({
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
      signal: controller.signal,
      onSlot: (taken) => {
        slot = taken;
      },
    });
  } finally {
    // The listener is what keeps the process alive after the run, so it is
    // taken off whether the run ended, failed or was stopped.
    releaseInterrupt();
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
