#!/usr/bin/env node
/**
 * One command turns a leaflet PDF into a HarvestDocument (plan 0001).
 *
 *   npx nx run luna-shopper/leaflet-cli:read -- --pdf tmp/dia_leaflet.pdf --chain dia
 *
 * Keep the `--`. Nx reads the flags in front of it as its own, and `--verbose`
 * is one of them, so a flag typed without the `--` is dropped in silence.
 *
 * Most of what this runs already existed. `build-document.mjs`,
 * `drift-check.mjs` and `validate.mjs` are steps 5, 6 and 7 of the README's
 * procedure (a) and they are called here unchanged. What the command adds is
 * steps 1 and 3: render the PDF to page images, and ask a model for each page.
 *
 * **The three price rules do not live here and are not duplicated here.**
 * `to-harvest-document.mjs` owns them. A CLI that decided a till price would be
 * a second authority on the one question the whole harvester exists to answer.
 *
 * **The command never uploads.** The report prints the document's path and the
 * call to make with it. A leaflet reading is accepted by a person looking at
 * it.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  ENGINES,
  ENGINE_NAMES,
  emptyUsage,
  engineEntry,
  stripFence,
} from '../../../../../shared/model-engines/src/index.mjs';
import {
  listChains,
  loadChainDefaults,
  readLayout,
  readPrompt,
  resolveChain,
} from './chains.mjs';
import { checkPage } from './check-page.mjs';
import { runWithInput } from './child.mjs';
import { formatPageList } from './commands.mjs';
import { isDay } from './document.mjs';
import { readRunFile } from './manual.mjs';
import { DEFAULT_PAGE_TIMEOUT_S } from './read-pages.mjs';
import { finishRun, runRead } from './run.mjs';

/** The engine that is a person. It is not a registry entry, because everything
 * in that registry builds an object with an `ask` method and this one has none
 * to build. The CLI branches on it before it asks the registry. */
export const MANUAL = 'manual';

/**
 * The engine a run takes when the operator names none, and the model it asks
 * (plan 0003).
 *
 * It used to be `ollama`, as a free first pass. Local vision models are
 * unreliable on leaflets, gemma4 was measured unstable on them, and the
 * developer asked for leaflets to be read by Sonnet or another strong vision
 * model and never by gemma4. The `claude` engine already hands a page to
 * `claude -p` through its Read tool, so the default is that, with Sonnet.
 * `sonnet` is the Claude Code alias, which follows the current Sonnet.
 */
export const DEFAULT_ENGINE = 'claude';
export const DEFAULT_MODEL = 'sonnet';

/** Where a run's working material goes when the operator names no directory. */
export const RUN_ROOT = 'tmp/leaflet';

/**
 * The longest answer one page of a leaflet has.
 *
 * The model engines default is 1,024 tokens, which was set for a curation
 * decision: one JSON object of a few hundred tokens. A leaflet page is a JSON
 * array of every offer printed on it, and three pages of El Jamon read live at
 * 1,024 answered 2 offers, `not a JSON array` and `not a JSON array`, both
 * dense pages recorded as empty with nothing saying why. The same three pages
 * at 4,096 answered 2, 8 and 9 offers, which is all 19 of the plan's section 7
 * table, in 63 seconds. A truncated answer is exactly the unparseable answer
 * case, and nothing in it says which one it was.
 *
 * `OLLAMA_NUM_PREDICT` still overrides this, because it is the operator's
 * override and outranks what a caller asked for.
 */
export const LEAFLET_NUM_PREDICT = 4096;

/** Where a help line's description starts. */
const HELP_COLUMN = 27;

/** The day, for a default `--out` nobody has to name. */
export const defaultOutDir = (slug, now = new Date()) =>
  `${RUN_ROOT}/${slug}-${now.toISOString().slice(0, 10)}`;

/** The help text, with the engine half read off the registry. */
export function usageText(engines = ENGINES, slugs = listChains()) {
  const indent = ' '.repeat(HELP_COLUMN);
  const line = (flag, text) => `  ${flag}`.padEnd(HELP_COLUMN) + text;
  const width = Math.max(...engines.map((entry) => entry.name.length));
  const perEngine = engines
    .map(
      (entry) => `    ${entry.name.padEnd(width)}  model ${entry.defaultModel}`
    )
    .join('\n');

  return `Usage: npx nx run luna-shopper/leaflet-cli:read -- [options]

  Keep the \`--\`. Nx reads what comes before it as its own flags, so an option
  typed without the \`--\` is dropped in silence.

${line('--pdf <path>', 'the leaflet. A PDF, or a directory of')}
${indent}page_NN.png that skips rendering. A directory
${indent}is read for the pages it holds
${line('--chain <slug>', 'which chain. Required, never guessed.')}
${indent}${slugs.length > 0 ? slugs.join(', ') : '(no chain folders found)'}
${line(`--engine <name>`, `${[...ENGINE_NAMES, MANUAL].join(', ')}. Default ${DEFAULT_ENGINE}`)}
${indent}with --model ${DEFAULT_MODEL}.
${line('--model <name>', "the engine's own default when absent")}
${line('--pages 1-12,31', 'read only these. Default: every page')}
${line('--out <dir>', `default ${RUN_ROOT}/<slug>-<date>`)}
${line('--dpi <n>', "the chain's own dpi when absent")}
${line('--valid-from <day>', 'the first day of the window, YYYY-MM-DD')}
${line('--valid-until <day>', 'the last day of the window, YYYY-MM-DD')}
${line('--resume', 'keep page readings already in --out. The pages,')}
${indent}the dpi and the dates come from run.json
${indent}when the flags are absent
${line('--check-page <n>', 'check one hand written page_NN.json in --out')}
${line('--finish', 'build, drift check and validate a manual run,')}
${indent}everything read from --out's run.json
${line('--dry-run', 'census and layout only. Read no page')}
${line('--page-timeout <s>', `give up on one page. Default ${DEFAULT_PAGE_TIMEOUT_S}`)}

  Each engine names its own default model:

${perEngine}
    ${MANUAL.padEnd(width)}  a person, with any model at all

  --engine ollama runs a local vision model, and local vision models are
  unreliable on leaflets. Name it only for a reading you will check page by
  page against the leaflet.

  --engine manual renders the pages, writes <out>/PROMPT.md and stops. Paste
  that file into Claude Code or any model you like, let it write one
  <out>/import/page_NN.json per page, check each with --out <out>
  --check-page N, then run --out <out> --finish.

  --page-timeout is not a tuning knob. It is the only thing that ends a looping
  local model, and a longer one collects nothing: three minutes and five
  minutes on the same page both produced zero rows. A page that hits it is
  recorded as an empty reading with a named warning and the run carries on.

  The command never uploads. It prints the document's path and the call to
  make with it, and a new chain's folder is still written by hand, which is
  procedure (b) of the README.
`;
}

/** `--flag value` and `--flag` alike, as the curator parses them. */
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

/** A day, as `--valid-from` and `--valid-until` take one, or null when absent. */
export function parseDay(name, value) {
  if (value === undefined) {
    return null;
  }
  if (!isDay(value)) {
    throw new Error(
      `${name} is ${value === true ? '(nothing)' : value}, and it has to be a day as YYYY-MM-DD.`
    );
  }
  return value;
}

/** A whole number of something, refused here rather than three layers down. */
export function parseNumber(name, value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(String(value).trim());
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(
      `${name} is ${value === true ? '(nothing)' : value}, and it has to be a whole number, one or more.`
    );
  }
  return number;
}

/** One line from the terminal, for an engine whose gate asks a question. */
function askLine() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((answer) => {
    rl.once('line', (line) => {
      rl.close();
      answer(line);
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
    ask = askLine,
    exists = existsSync,
    stat = statSync,
    readFile = readFileSync,
    readRun = readRunFile,
    read = runRead,
    finish = finishRun,
    // How an entry becomes an engine. Injected because a built engine does not
    // report what it was built with, so this is the one place a test can see
    // the ceiling the leaflet workload asks for.
    build = (entry, config) => entry.create(config),
    now = () => new Date(),
  } = {}
) {
  const flags = parseArgs(argv);
  if (flags.help) {
    stdout.write(usageText());
    return 0;
  }

  const outFlag = typeof flags.out === 'string' ? flags.out : null;

  // One hand written page, checked. It needs no chain and no engine, only the
  // run's folder, so it answers before either is resolved.
  if (flags['check-page'] !== undefined) {
    if (!outFlag) {
      throw new Error(
        '--check-page needs --out <dir>, the run whose page it checks.'
      );
    }
    const page = parseNumber('--check-page', flags['check-page']);
    const { ok, lines } = checkPage({
      page,
      importDir: join(outFlag, 'import'),
      outDir: outFlag,
      stripFence,
      exists,
      readFile,
    });
    stdout.write(`${lines.join('\n')}\n`);
    return ok ? 0 : 1;
  }

  // The window a person states, on any engine. It outranks the cover.
  const statedValidity = {
    from: parseDay('--valid-from', flags['valid-from']),
    until: parseDay('--valid-until', flags['valid-until']),
  };
  if (
    statedValidity.from &&
    statedValidity.until &&
    statedValidity.from > statedValidity.until
  ) {
    throw new Error(
      `--valid-from ${statedValidity.from} is after --valid-until ${statedValidity.until}.`
    );
  }

  // `--resume` with an `--out` alone picks a run back up, and what it needs is
  // the PDF and the chain, neither of which it was given. The first pass wrote
  // both into `<out>/run.json` rather than asking an operator to type them
  // twice and get one of them wrong.
  const recorded = outFlag ? readRun(outFlag) : null;

  // A manual run's last three steps, with everything read from run.json.
  if (flags.finish === true) {
    if (!recorded) {
      throw new Error(
        `--finish needs --out <dir> of a run that wrote run.json${outFlag ? `, and ${outFlag} holds none` : ''}.`
      );
    }
    const chain = resolveChain(recorded.chain ?? null);
    const outcome = await finish({
      chain,
      defaults: await loadChainDefaults(chain),
      outDir: outFlag,
      recorded,
      statedValidity,
      stripFence,
      stdout,
    });
    return outcome.code ?? 0;
  }

  // What a resume reads back when the flags do not say it (plan 0003). A resume
  // without `--pages` used to mean every page, and one without the dates lost
  // the window the first pass was given.
  const resume = flags.resume === true;
  const carried = resume ? recorded : null;

  const slug =
    typeof flags.chain === 'string' ? flags.chain : (recorded?.chain ?? null);
  // Refused before anything is rendered or asked, and the refusal lists the
  // slugs there are rather than describing them.
  const chain = resolveChain(slug);
  const defaults = await loadChainDefaults(chain);

  const engineNamed = typeof flags.engine === 'string';
  const engineName = engineNamed ? flags.engine : DEFAULT_ENGINE;
  const manual = engineName === MANUAL;
  // Manual mode branches before the registry, because it has no `ask` to build.
  const entry = manual ? null : engineEntry(engineName);
  const model =
    typeof flags.model === 'string'
      ? flags.model
      : engineNamed
        ? (entry?.defaultModel ?? null)
        : DEFAULT_MODEL;

  const source =
    typeof flags.pdf === 'string' ? flags.pdf : (recorded?.pdf ?? null);
  if (!source) {
    throw new Error(
      "--pdf is required: the leaflet PDF, or a directory of page_NN.png. A run picked up with --out and --resume reads it from that run's own run.json."
    );
  }
  if (!exists(source)) {
    throw new Error(`--pdf ${source} is not there.`);
  }
  const sourceIsDirectory = stat(source).isDirectory();

  const outDir = outFlag ?? defaultOutDir(chain.slug, now());
  const dpi = parseNumber('--dpi', flags.dpi, carried?.dpi ?? defaults.dpi);
  const pagesSpec =
    flags.pages ??
    (Array.isArray(carried?.pages) && carried.pages.length > 0
      ? formatPageList(carried.pages)
      : undefined);
  const timeoutMs =
    parseNumber(
      '--page-timeout',
      flags['page-timeout'],
      DEFAULT_PAGE_TIMEOUT_S
    ) * 1000;

  let engine = null;
  if (entry) {
    const usage = emptyUsage();
    // The gate is whatever this entry needs confirmed before it runs, and its
    // answer is what builds the engine. An entry with no gate is asked nothing.
    const gated = entry.gate
      ? await entry.gate({ env, isTty, askLine: ask, stdout })
      : null;
    engine = build(entry, {
      env,
      model,
      usage,
      stderr,
      gated,
      // What the claude entry starts `claude -p` with. It has no default, so an
      // engine built without it threw on its first call.
      spawn: runWithInput,
      // A page of offers is a longer answer than the library's own default was
      // set for. An entry with no such ceiling ignores the key.
      numPredict: LEAFLET_NUM_PREDICT,
    });
  }

  const outcome = await read({
    chain,
    defaults,
    source,
    sourceIsDirectory,
    outDir,
    pagesSpec,
    dpi,
    resume,
    dryRun: flags['dry-run'] === true,
    manual,
    timeoutMs,
    engine,
    engineName,
    model,
    isLocal: entry?.local === true,
    statedValidity,
    recordedValidity: carried?.validity ?? null,
    prompt: readPrompt(chain),
    layout: readLayout(chain),
    stripFence,
    stdout,
    stderr,
    now,
  });
  return outcome.code ?? 0;
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
