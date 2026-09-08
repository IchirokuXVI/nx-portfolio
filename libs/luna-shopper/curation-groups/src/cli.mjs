#!/usr/bin/env node
/**
 * The group decider CLI (plan 0001).
 *
 * The same contract as `curation-suggestions`, over a different domain:
 * ungrouped catalog products, sorted into product groups. Invoked once per
 * step, it keeps its state in a run directory and answers one JSON object on
 * stdout and nothing else, so the thing driving it holds no state and no
 * credentials. That thing is normally `curation-cli`; a person poking at it by
 * hand gets exactly the same contract.
 *
 *   node .../cli.mjs start --main-url <u> --rehearsal-url <u> --run-dir <dir>
 *   node .../cli.mjs next --run-dir <dir>
 *   node .../cli.mjs decide --run-dir <dir> --item <id>   # decision on stdin
 *   node .../cli.mjs end --run-dir <dir>
 *   node .../cli.mjs apply --main-url <u> --file <decisions.jsonl>
 *
 * Progress and errors go to stderr. stdout is machine readable, always.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { apply, decide, end, next, start } from './commands.mjs';

const USAGE = `Usage: node cli.mjs <start|next|decide|end|apply> [options]

  start   --main-url <u> --rehearsal-url <u> --run-dir <dir>
          [--main-user <name>] [--main-password <p>] [--model <name>] [--limit <n>]
          Verifies both admin logins, counts the ungrouped products, and
          answers { runId, remaining, ungrouped, prompt }.

  next    --run-dir <dir> [--main-password <p>]
          Answers one product: { item, candidates, remaining },
          or { done: true }.

  decide  --run-dir <dir> --item <id> [--final] [--main-password <p>]
          The model's JSON on stdin. Answers
          { accepted, retryable, decision, issues, remaining }.
          Without --final a reply that breaks the schema answers
          retryable: true and writes nothing, so the caller can ask again.

  end     --run-dir <dir> [--usage <json>]
          Writes the report and answers its path.

  apply   --main-url <u> --file <decisions.jsonl>
          [--main-user <name>] [--main-password <p>] [--route <path>]
          The replay: no model, no slot, one request that lands whole or not
          at all.
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

/** `--limit` takes a whole number of products, or it takes nothing. */
function optionalCount(flags, name) {
  const raw = flags[name];
  if (raw === undefined) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} takes a whole number, 1 or more`);
  }
  return value;
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
      limit: optionalCount(flags, 'limit'),
    });
  }

  if (command === 'next') {
    return next({
      runDir: required(flags, 'run-dir'),
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
      itemId: required(flags, 'item'),
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

  throw new Error(`Unknown command ${command}.\n\n${USAGE}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (answer) => {
      process.stdout.write(`${JSON.stringify(answer)}\n`);
    },
    (error) => {
      process.stderr.write(`${error.message ?? error}\n`);
      process.exitCode = 1;
    }
  );
}
