#!/usr/bin/env node
// Which leaflets each chain publishes right now, and which of them are new.
//
//   node tools/leaflets/find-leaflets.mjs                # every chain, grocery only
//   node tools/leaflets/find-leaflets.mjs --chain lidl   # one chain
//   node tools/leaflets/find-leaflets.mjs --download tmp/leaflets/pdf
//   node tools/leaflets/find-leaflets.mjs --json > report.json
//
// Plain `node`, no dependencies and no Nx project, like `tools/release/`.
//
// The finder asks each chain module for every leaflet it publishes, drops the
// kinds nobody reads (bazar, outlets), folds editions with identical content
// into one entry however many regions list them, and compares the rest with a
// state file that remembers every content hash seen so far. A leaflet is new
// when its hash is not in the file. The state file also keeps `latest`, the
// hash of the most recent leaflet each chain published, and it is written only
// after a run that reached every chain it asked for.
//
// A leaflet, as a chain module answers it:
//
//   {
//     chain: 'lidl',
//     sourceId: '<the publisher id of this edition>',
//     name, title, kind: 'grocery' | 'bazar' | 'other', category,
//     pdfUrl, fileSize, startDate, endDate, offerStartDate, offerEndDate,
//     viewerUrl,
//     regions: [{ code, name, zone }],
//     contentHash: { algorithm: 'etag' | 'sha256' | 'source-id', value },
//   }
//
// Options:
//   --chain <key>        run one chain; repeatable
//   --state <path>       state file, default tmp/leaflets/state.json
//   --download <dir>     download every new PDF into <dir>/<chain>/ and record its sha256
//   --regions <list>     sweep only these region codes, e.g. 0,26 or 0-10 (chain specific)
//   --all                keep bazar and other kinds too
//   --json               print the report as JSON instead of text
//   --dry-run            report, but do not touch the state file
//   --pause <ms>         delay between requests, default 250

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAINS } from './chains/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, '..', '..');
const DEFAULT_STATE = join(workspaceRoot, 'tmp', 'leaflets', 'state.json');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STATE_VERSION = 1;

// --- Arguments --------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    chains: [],
    state: DEFAULT_STATE,
    download: null,
    regions: null,
    all: false,
    json: false,
    dryRun: false,
    pauseMs: 250,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '--chain':
        options.chains.push(next());
        break;
      case '--state':
        options.state = resolve(next());
        break;
      case '--download':
        options.download = resolve(next());
        break;
      case '--regions':
        options.regions = parseRegionsArg(next());
        break;
      case '--pause':
        options.pauseMs = Number(next());
        break;
      case '--all':
        options.all = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  return options;
}

/** `0,26,28` or `0-10` or a mix, into a list of distinct codes in order. */
export function parseRegionsArg(text) {
  const codes = [];
  for (const part of String(text).split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const range = piece.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from) throw new Error(`bad range ${piece}`);
      for (let n = from; n <= to; n++) codes.push(String(n));
    } else if (/^\d+$/.test(piece)) {
      codes.push(piece);
    } else {
      throw new Error(`bad region code ${piece}`);
    }
  }
  return [...new Set(codes)];
}

// --- HTTP -------------------------------------------------------------------

export function createHttp({ pauseMs = 250, fetchImpl = fetch } = {}) {
  let last = 0;
  let requests = 0;
  const wait = async () => {
    const due = last + pauseMs;
    const now = Date.now();
    if (due > now) await new Promise((r) => setTimeout(r, due - now));
    last = Date.now();
    requests += 1;
  };
  const headers = (extra = {}) => ({
    'user-agent': USER_AGENT,
    accept: '*/*',
    'accept-language': 'es-ES,es;q=0.9',
    ...extra,
  });
  return {
    get requests() {
      return requests;
    },
    async json(url, extra = {}) {
      await wait();
      const response = await fetchImpl(url, { headers: headers(extra) });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${response.status} and no JSON from ${url}`);
      }
    },
    async head(url) {
      await wait();
      const response = await fetchImpl(url, {
        method: 'HEAD',
        headers: headers(),
      });
      return {
        status: response.status,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentLength: response.headers.get('content-length'),
      };
    },
    async download(url) {
      await wait();
      const response = await fetchImpl(url, { headers: headers() });
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

// --- The pure part ----------------------------------------------------------

/** The key one content hash is stored under. */
export function hashKey(contentHash) {
  return `${contentHash.algorithm}:${contentHash.value}`;
}

/**
 * Editions with identical content become one entry that lists every region.
 * Two regions answering the same flyer id already arrive as one edition; this
 * is for two flyer ids whose PDFs are the same bytes.
 */
export function mergeEditions(leaflets) {
  const byHash = new Map();
  for (const leaflet of leaflets) {
    const key = hashKey(leaflet.contentHash);
    const merged = byHash.get(key);
    if (!merged) {
      byHash.set(key, {
        ...leaflet,
        sourceIds: [leaflet.sourceId],
        regions: [...leaflet.regions],
      });
      continue;
    }
    merged.sourceIds.push(leaflet.sourceId);
    for (const region of leaflet.regions) {
      if (!merged.regions.some((r) => r.code === region.code)) {
        merged.regions.push(region);
      }
    }
  }
  const merged = [...byHash.values()];
  for (const edition of merged) {
    edition.regions.sort((a, b) => Number(a.code) - Number(b.code));
  }
  return merged.sort(
    (a, b) =>
      String(b.offerStartDate ?? '').localeCompare(
        String(a.offerStartDate ?? '')
      ) ||
      a.name.localeCompare(b.name) ||
      Number(a.regions[0]?.code ?? 0) - Number(b.regions[0]?.code ?? 0)
  );
}

export function emptyState() {
  return { version: STATE_VERSION, chains: {} };
}

/** The editions the state file has not seen, and the ones it has. */
export function diffAgainstState(state, chainKey, editions) {
  const known = state.chains?.[chainKey]?.leaflets ?? {};
  const fresh = [];
  const seen = [];
  for (const edition of editions) {
    (known[hashKey(edition.contentHash)] ? seen : fresh).push(edition);
  }
  return { fresh, seen };
}

/**
 * Remember every fresh edition and move `latest` to the most recent leaflet
 * the chain published, by offer start date. Returns the same state object.
 */
export function applyToState(state, chainKey, fresh, ranAt) {
  const chain = (state.chains[chainKey] ??= { leaflets: {}, latest: null });
  chain.lastRunAt = ranAt;
  for (const edition of fresh) {
    chain.leaflets[hashKey(edition.contentHash)] = {
      sourceIds: edition.sourceIds ?? [edition.sourceId],
      name: edition.name,
      title: edition.title,
      kind: edition.kind,
      pdfUrl: edition.pdfUrl,
      fileSize: edition.fileSize ?? null,
      offerStartDate: edition.offerStartDate ?? null,
      offerEndDate: edition.offerEndDate ?? null,
      regions: edition.regions.map((r) => r.code),
      sha256: edition.sha256 ?? null,
      file: edition.file ?? null,
      firstSeenAt: ranAt,
    };
  }
  let latest = chain.latest;
  for (const edition of fresh) {
    const candidate = {
      hash: hashKey(edition.contentHash),
      name: edition.name,
      offerStartDate: edition.offerStartDate ?? null,
      seenAt: ranAt,
    };
    // A tie keeps what is already there: the first edition of a week the
    // finder met, or the one an earlier run recorded.
    if (
      !latest ||
      String(candidate.offerStartDate ?? '') >
        String(latest.offerStartDate ?? '')
    ) {
      latest = candidate;
    }
  }
  chain.latest = latest;
  return state;
}

// --- Output -----------------------------------------------------------------

function megabytes(bytes) {
  return bytes == null ? '?' : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function regionLine(regions) {
  const names = regions.map((r) => r.name);
  return names.length > 8
    ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more`
    : names.join(', ');
}

export function render(report) {
  const lines = [];
  for (const chain of report.chains) {
    if (chain.error) {
      lines.push(`${chain.name}: FAILED, ${chain.error}`);
      continue;
    }
    const skipped = Object.entries(chain.skipped)
      .map(([kind, n]) => `${n} ${kind}`)
      .join(', ');
    lines.push(
      `${chain.name}: ${chain.fresh.length} new, ${chain.seen.length} already known` +
        ` (${chain.found} flyer ids over ${chain.regionsSwept} regions` +
        (skipped ? `, skipped ${skipped}` : '') +
        ')'
    );
    for (const edition of chain.fresh) {
      lines.push(
        `  NEW   ${edition.name}  (${edition.title})  offers ${edition.offerStartDate ?? '?'} to ${edition.offerEndDate ?? '?'}`
      );
      lines.push(
        `        ${hashKey(edition.contentHash)}  ${megabytes(edition.fileSize)}` +
          (edition.sha256 ? `  sha256 ${edition.sha256}` : '')
      );
      lines.push(`        regions: ${regionLine(edition.regions)}`);
      if (edition.pdfUrl) lines.push(`        ${edition.pdfUrl}`);
      if (edition.file) lines.push(`        saved ${edition.file}`);
    }
    for (const edition of chain.seen) {
      lines.push(
        `  known ${edition.name}  (${edition.title})  ${hashKey(edition.contentHash)}  regions: ${regionLine(edition.regions)}`
      );
    }
    if (chain.latest) {
      lines.push(
        `  latest: ${chain.latest.name} from ${chain.latest.offerStartDate ?? '?'}, ${chain.latest.hash}`
      );
    }
  }
  lines.push(
    report.dryRun ? `state not written (dry run)` : `state: ${report.statePath}`
  );
  return lines.join('\n');
}

// --- Main -------------------------------------------------------------------

function readState(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
  const state = JSON.parse(text);
  if (state.version !== STATE_VERSION) {
    throw new Error(
      `${path} is state version ${state.version}, this tool writes ${STATE_VERSION}`
    );
  }
  state.chains ??= {};
  return state;
}

function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function safeFileName(text) {
  return String(text).replace(/[^A-Za-z0-9._-]+/g, '-');
}

async function downloadFresh(http, dir, chainKey, fresh, log) {
  const target = join(dir, chainKey);
  mkdirSync(target, { recursive: true });
  for (const edition of fresh) {
    if (!edition.pdfUrl) continue;
    const bytes = await http.download(edition.pdfUrl);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = join(
      target,
      `${safeFileName(edition.sourceId)}-${safeFileName(edition.name)}.pdf`
    );
    writeFileSync(file, bytes);
    edition.sha256 = sha256;
    edition.file = file;
    log(`${chainKey}: saved ${file} (${megabytes(bytes.length)})`);
  }
}

export async function run(options, { http, chains = CHAINS, log } = {}) {
  const selected = options.chains.length
    ? options.chains.map((key) => {
        const chain = chains.find((c) => c.key === key);
        if (!chain) {
          throw new Error(
            `no chain ${key}; known: ${chains.map((c) => c.key).join(', ')}`
          );
        }
        return chain;
      })
    : chains;
  const ranAt = new Date().toISOString();
  const state = readState(options.state);
  const report = {
    ranAt,
    statePath: options.state,
    dryRun: options.dryRun,
    chains: [],
  };
  let failed = false;

  for (const chain of selected) {
    try {
      const found = await chain.findLeaflets(http, {
        regions: options.regions,
        log,
      });
      const skipped = {};
      const wanted = found.filter((leaflet) => {
        if (options.all || leaflet.kind === 'grocery') return true;
        skipped[leaflet.kind] = (skipped[leaflet.kind] ?? 0) + 1;
        return false;
      });
      const editions = mergeEditions(wanted);
      const { fresh, seen } = diffAgainstState(state, chain.key, editions);
      if (options.download && fresh.length) {
        await downloadFresh(http, options.download, chain.key, fresh, log);
      }
      applyToState(state, chain.key, fresh, ranAt);
      report.chains.push({
        key: chain.key,
        name: chain.name,
        found: found.length,
        regionsSwept: new Set(
          found.flatMap((l) => l.regions.map((r) => r.code))
        ).size,
        skipped,
        fresh,
        seen,
        latest: state.chains[chain.key].latest,
      });
    } catch (error) {
      failed = true;
      report.chains.push({
        key: chain.key,
        name: chain.name,
        error: error.message,
      });
    }
  }

  if (!options.dryRun && !failed) writeState(options.state, state);
  report.requests = http.requests;
  return { report, failed };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.help) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 42)
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join('\n')
    );
    process.exit(0);
  }
  const http = createHttp({ pauseMs: options.pauseMs });
  const log = options.json ? () => {} : (line) => console.error(line);
  const { report, failed } = await run(options, { http, log });
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(render(report));
  process.exit(failed ? 1 : 0);
}
