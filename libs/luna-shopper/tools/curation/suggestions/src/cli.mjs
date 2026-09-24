#!/usr/bin/env node
/**
 * The decider CLI (plan 0001).
 *
 * Invoked once per step, it keeps its state in a run directory and answers one
 * JSON object on stdout and nothing else, so the thing driving it holds no
 * state and no credentials. That thing is normally `curation-cli`; a person
 * poking at it by hand gets exactly the same contract.
 *
 *   node .../cli.mjs start --main-url <u> --rehearsal-url <u> --run-dir <dir>
 *   node .../cli.mjs next --run-dir <dir>
 *   node .../cli.mjs decide --run-dir <dir> --row <id>     # decision on stdin
 *   node .../cli.mjs end --run-dir <dir>
 *   node .../cli.mjs apply --main-url <u> --file <decisions.jsonl>
 *   node .../cli.mjs serve                                 # one process, many steps
 *   node .../cli.mjs propose-brands --run-dir <dir>        # no model, writes a file
 *
 * `serve` is the same five commands over a line protocol, so a walk pays one
 * process start instead of one per step (plan 0002). See `serve.mjs`.
 *
 * Progress and errors go to stderr. stdout is machine readable, always.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { apply, decide, end, next, proposeBrands, start } from './commands.mjs';
import { serve } from './serve.mjs';

const USAGE = `Usage: node cli.mjs <start|next|decide|end|apply|propose-brands|serve> [options]

  start   --main-url <u> --rehearsal-url <u> --run-dir <dir>
          [--main-user <name>] [--main-password <p>] [--model <name>] [--chain <id>]
          [--local] [--allow-empty-registry]
          --local says the model answering this run is on this machine, which
          buys the run one extra validator (plan 0003).
          Verifies both admin logins, counts the queue, snapshots the brand
          registry into the run directory, and answers
          { runId, remaining, brands, notes, prompt }.
          An empty brand registry stops here and prints the propose-brands
          command to run instead, unless --allow-empty-registry is given.

  next    --run-dir <dir> [--count <n>] [--main-password <p>]
          Answers one row: { entry, candidates, eanMatch, remaining },
          or { done: true }.
          With --count, answers { rows, remaining } instead: up to n rows
          whose normalized names are pairwise distinct, so a caller can ask
          a model about all of them at once.

  decide  --run-dir <dir> --row <id> [--final] [--main-password <p>]
          --entry <id> is the same flag under its older name.
          The model's JSON on stdin. Answers
          { accepted, retryable, decision, issues, remaining }.
          Without --final a reply that breaks the schema answers
          retryable: true and writes nothing, so the caller can ask again.
          A row whose candidates changed since next handed it out answers
          { stale: true, packet } and writes nothing, whatever --final says:
          the model was asked the wrong question, so ask it the one in
          packet and decide again.

  end     --run-dir <dir> [--usage <json>]
          Writes the report and answers its path.

  apply   --main-url <u> --file <decisions.jsonl>
          [--main-user <name>] [--main-password <p>] [--route <path>]
          The replay: no model, no slot, one request that lands whole or not
          at all.

  serve   The five commands above over one process instead of one process
          each. Reads one request per line on stdin,
          { id, command, args, input }, and answers one line per request,
          { id, answer } or { id, error }. Ends when stdin closes.

  propose-brands --run-dir <dir> [--main-url <u>] [--main-user <name>]
          [--main-password <p>] [--chain <id>]
          Reads the queue with no model and writes brands-to-register.json
          into the run directory: the body POST
          /v1/admin/catalog/brands/register-many takes, one suggested label
          per brand the queue prints that the registry does not hold. More
          than 200 brands go into brands-to-register-2.json and on, one body
          per request. brands-to-register.notes.json beside it holds each
          brand's key, the spellings printed, how many entries carry it, and
          the chain ids a house label names. Registers nothing.
          --main-url is needed only when the directory holds no run.
`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, flags: {} };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument ${token}`);
    }
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options.flags[name] = true;
    } else {
      options.flags[name] = next;
      i += 1;
    }
  }
  return options;
}

function required(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`--${name} is required`);
  }
  return value;
}

/**
 * A flag that has to be a whole number of rows.
 *
 * `--count` with no value parses as `true`, and `Number(true)` is 1, so a typed
 * flag would silently become a batch of one. It is refused instead.
 */
function positive(flags, name) {
  const value = flags[name];
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} takes a whole number of rows, 1 or more`);
  }
  return parsed;
}

/**
 * Which flag names the row (curation cli plan 0005).
 *
 * `--row` is what the orchestrator sends to both deciders, and `--entry` is
 * this decider's older name for it, kept for anyone driving it by hand. A
 * missing row is reported as `--row`, the name to use from now on.
 */
function rowFlag(flags, alias) {
  return flags.row === undefined && flags[alias] !== undefined ? alias : 'row';
}

function readStdin(fd = 0) {
  return readFileSync(fd, 'utf8');
}

export async function run(argv, { stdin = readStdin } = {}) {
  const { command, flags } = parseArgs(argv);

  if (!command || flags.help) {
    return { usage: USAGE };
  }

  if (command === 'start') {
    return start({
      mainUrl: required(flags, 'main-url'),
      rehearsalUrl: required(flags, 'rehearsal-url'),
      runDir: required(flags, 'run-dir'),
      mainUser:
        typeof flags['main-user'] === 'string' ? flags['main-user'] : undefined,
      mainPassword:
        typeof flags['main-password'] === 'string'
          ? flags['main-password']
          : undefined,
      model: typeof flags.model === 'string' ? flags.model : null,
      local: flags.local === true,
      chain: typeof flags.chain === 'string' ? flags.chain : null,
      allowEmptyRegistry: flags['allow-empty-registry'] === true,
    });
  }

  if (command === 'propose-brands') {
    return proposeBrands({
      runDir: required(flags, 'run-dir'),
      mainUrl: typeof flags['main-url'] === 'string' ? flags['main-url'] : null,
      mainUser:
        typeof flags['main-user'] === 'string' ? flags['main-user'] : undefined,
      mainPassword:
        typeof flags['main-password'] === 'string'
          ? flags['main-password']
          : undefined,
      chain: typeof flags.chain === 'string' ? flags.chain : null,
    });
  }

  if (command === 'next') {
    return next({
      runDir: required(flags, 'run-dir'),
      count: flags.count === undefined ? null : positive(flags, 'count'),
      mainPassword:
        typeof flags['main-password'] === 'string'
          ? flags['main-password']
          : undefined,
    });
  }

  if (command === 'decide') {
    const text = stdin();
    let input;
    try {
      input = JSON.parse(text);
    } catch (error) {
      throw new Error(`the decision on stdin is not JSON: ${error.message}`);
    }
    return decide({
      runDir: required(flags, 'run-dir'),
      entryId: required(flags, rowFlag(flags, 'entry')),
      input,
      final: flags.final === true,
      mainPassword:
        typeof flags['main-password'] === 'string'
          ? flags['main-password']
          : undefined,
    });
  }

  if (command === 'end') {
    return end({
      runDir: required(flags, 'run-dir'),
      usage: typeof flags.usage === 'string' ? JSON.parse(flags.usage) : null,
    });
  }

  if (command === 'apply') {
    return apply({
      mainUrl: required(flags, 'main-url'),
      file: required(flags, 'file'),
      mainUser:
        typeof flags['main-user'] === 'string' ? flags['main-user'] : undefined,
      mainPassword:
        typeof flags['main-password'] === 'string'
          ? flags['main-password']
          : undefined,
      ...(typeof flags.route === 'string' ? { route: flags.route } : {}),
    });
  }

  // `serve` is in the usage but not here: it owns stdin and stdout for as long
  // as it runs, so it cannot answer one object the way the other five do. It is
  // dispatched at the bottom of this file instead.
  if (command === 'serve') {
    throw new Error(
      'serve is not one of the commands that answer one object; it is dispatched from the command line only.'
    );
  }

  throw new Error(`Unknown command ${command}.\n\n${USAGE}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// `serve` is the one command that is not "answer one object and exit", so it is
// dispatched here rather than from `run`: it owns the streams for as long as it
// runs, and the answer lines are written by the loop itself.
if (invokedDirectly && process.argv[2] === 'serve') {
  serve({ input: process.stdin, output: process.stdout, run }).then(
    () => {
      process.exitCode = 0;
    },
    (error) => {
      process.stderr.write(`${error.message ?? error}\n`);
      process.exitCode = 1;
    }
  );
} else if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (answer) => {
      process.stdout.write(`${JSON.stringify(answer)}\n`);
      // Only `apply` carries a verdict, and a refused file is a 201 answer
      // rather than an error, so nothing else would tell a shell that the
      // replay wrote nothing. The JSON is printed either way: it names the row
      // that failed, which is what the operator needs.
      if (answer?.applied === false) {
        process.exitCode = 2;
      }
    },
    (error) => {
      process.stderr.write(`${error.message ?? error}\n`);
      process.exitCode = 1;
    }
  );
}
