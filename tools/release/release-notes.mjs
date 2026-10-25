#!/usr/bin/env node
// Release notes, filtered from pull request titles.
//
// A release here is a tag on `main`, and the work in it arrived as pull requests
// merged into `dev`. This script walks the commits between two refs, picks out
// the pull requests that produced them, reads each title through the shared
// rules in ./rules.mjs, and groups the conforming ones into markdown sections.
//
// What it deliberately does NOT do is drop anything quietly. A title that breaks
// the rules is printed under a heading that says so, and work that reached the
// branch without a pull request is counted and listed too, so the notes can be
// trusted as a complete account of a range rather than a best effort one.
//
//   node tools/release/release-notes.mjs                       # last tag to HEAD
//   node tools/release/release-notes.mjs --version v0.3.2      # the same, linked to the tag
//   node tools/release/release-notes.mjs --from v0.3.1 --to v0.3.2
//   node tools/release/release-notes.mjs --to v0.3.2 --out notes.md
//   node tools/release/release-notes.mjs --audit                # only the offenders
//   node tools/release/release-notes.mjs --check "feat(velista): a title"
//   node tools/release/release-notes.mjs --unit velista --version velista-v0.15.0
//
// `gh` must be logged in for everything except --check and --commits.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseTitle,
  SCOPES,
  sectionFor,
  sectionOrder,
  TYPES,
  UNITS,
  WORKSPACE_SCOPES,
} from './rules.mjs';

const USAGE = `Usage: node tools/release/release-notes.mjs [options]

  --unit <unit>    The notes of one deploy unit (k8s plan 0017): its own scopes, the
                   workspace scopes and titles with no scope. --from then defaults
                   to the unit's previous tag, and --version must carry the
                   unit's prefix.
  --from <ref>     Start of the range, exclusive. Default: the tag before --to
                   (with --unit, the tag before --to with the unit's prefix).
  --to <ref>       End of the range, inclusive. Default: HEAD.
  --version <v>    Title the notes with this version, and end the changelog link there.
                   Default: --to, when it is a tag. With neither, the link is left out.
  --all            Also print the sections a user cannot see (docs, ci, chore, ...).
  --audit          Print only the titles that break the rules, and exit 1 if any do.
  --strict         Print the notes, but exit 1 if any title breaks the rules.
  --check [title]  Validate one title and exit. With no argument, reads $PR_TITLE.
  --commits        Build from commit subjects instead of pull requests (no gh needed).
  --json           Machine readable output.
  --out <file>     Write to a file instead of stdout.
  --help           This.
`;

// ---------------------------------------------------------------------------
// Shelling out
// ---------------------------------------------------------------------------

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function git(args) {
  return run('git', args);
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function gh(args) {
  try {
    return run('gh', args);
  } catch (error) {
    const detail = String(error.stderr ?? error.message ?? '').trim();
    throw new Error(
      `\`gh ${args.join(' ')}\` failed. Install the GitHub CLI and run \`gh auth login\`, ` +
        `or pass --commits to build the notes from commit subjects instead.\n${detail}`
    );
  }
}

// ---------------------------------------------------------------------------
// The range, and what is in it
// ---------------------------------------------------------------------------

/**
 * The tag before `ref`, which is what a release is normally measured from.
 * With a prefix only that unit's tags count, so a release of the other unit in
 * between does not shorten the range.
 */
function previousTag(ref, prefix = null) {
  const match = prefix ? ['--match', `${prefix}*`] : [];
  return tryGit(['describe', '--tags', '--abbrev=0', ...match, `${ref}^`]);
}

// ---------------------------------------------------------------------------
// Deploy units
// ---------------------------------------------------------------------------

const UNITS_DIR = fileURLToPath(new URL('../../k8s/units', import.meta.url));

/** TAG_PREFIX of k8s/units/<unit>/unit.env, the one place the prefix is written. */
function tagPrefix(unit, unitsDir = UNITS_DIR) {
  const file = `${unitsDir}/${unit}/unit.env`;
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const match = /^TAG_PREFIX=["']?([^"'\s]+)["']?\s*$/m.exec(
    readFileSync(file, 'utf8').replace(/\r/g, '')
  );
  if (!match) throw new Error(`${file} has no TAG_PREFIX`);
  return match[1];
}

/**
 * Whether an entry belongs in the notes of `unit`. A title that cannot be read
 * stays in the notes of every unit, because leaving it out would hide it.
 */
function belongsToUnit(parsed, unit) {
  if (!parsed.ok || parsed.scopes.length === 0) return true;
  return parsed.scopes.some(
    (scope) => UNITS[unit].includes(scope) || WORKSPACE_SCOPES.includes(scope)
  );
}

/** The entries of one unit, and how many were left out as another unit's. */
function filterForUnit(entries, unit) {
  if (!unit) return { entries, otherUnits: 0 };
  const kept = entries.filter((entry) => belongsToUnit(entry.parsed, unit));
  return { entries: kept, otherUnits: entries.length - kept.length };
}

const RELEASE_TAG = /^(?:[a-z][a-z0-9-]*-)?v?\d+\.\d+\.\d+/;

/** A version tag, bare (`v0.14.3`) or with a unit prefix (`velista-v0.15.0`). */
function isReleaseTag(ref) {
  return RELEASE_TAG.test(ref);
}

function isUnitTag(ref, prefix) {
  return (
    ref.startsWith(prefix) && /^\d+\.\d+\.\d+/.test(ref.slice(prefix.length))
  );
}

const RECORD = '%H\x1f%P\x1f%s';

function commitsIn(range, extraArgs = []) {
  const raw = git(['log', ...extraArgs, `--format=${RECORD}`, ...range]);
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [hash, parents, subject] = line.split('\x1f');
    return { hash, parents: parents ? parents.split(' ') : [], subject };
  });
}

/**
 * The pull request a merge commit closed, or null.
 *
 * Both merge strategies are read: the merge commit GitHub writes for a merge
 * commit merge, and the trailing `(#123)` it writes for a squash merge, so the
 * script keeps working if the repository ever switches.
 */
function pullRequestNumber(subject) {
  const merged = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merged) return Number(merged[1]);
  const squashed = /\(#(\d+)\)\s*$/.exec(subject);
  if (squashed) return Number(squashed[1]);
  return null;
}

/**
 * A pull request from `dev` into `main`, or from `main` into anything, carries
 * no work of its own: it is a rollup of pull requests that are already in the
 * range and would otherwise be counted twice, once as themselves and once as
 * the rollup.
 */
function isRollup(pr) {
  return pr.headRefName === 'dev' || pr.headRefName === 'main';
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const PR_FIELDS = 'number,title,url,headRefName,baseRefName,mergedAt,author';

function fetchPullRequests(numbers) {
  const wanted = new Set(numbers);
  const found = new Map();
  if (wanted.size === 0) return found;

  // One listing covers almost every case; a range that reaches further back
  // than the listing falls through to a lookup per missing number.
  const listed = JSON.parse(
    gh(['pr', 'list', '--state', 'all', '--limit', '300', '--json', PR_FIELDS])
  );
  for (const pr of listed) {
    if (wanted.has(pr.number)) found.set(pr.number, pr);
  }

  for (const number of wanted) {
    if (found.has(number)) continue;
    found.set(
      number,
      JSON.parse(gh(['pr', 'view', String(number), '--json', PR_FIELDS]))
    );
  }

  return found;
}

function repoSlug() {
  const url = tryGit(['remote', 'get-url', 'origin']);
  if (!url) return null;
  const match = /github\.com[/:]+([^/]+\/[^/.]+)(\.git)?$/.exec(
    url.replace(/\/+$/, '')
  );
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Collecting the entries
// ---------------------------------------------------------------------------

/**
 * Everything in the range, as entries the renderer can group.
 *
 * Claiming is the part worth reading. A pull request that is included claims
 * the commits on its own side of its merge, so nothing under it is reported a
 * second time as loose work. A rollup claims nothing, because the pull requests
 * inside it are detected by their own merge commits and the commits that
 * reached the branch some other way are exactly what the last section is for.
 */
function collect({ from, to, useCommits }) {
  const range = from ? [`${from}..${to}`] : [to];
  const merges = commitsIn(range, ['--merges']);
  const entries = [];
  const claimed = new Set();
  let rollups = 0;

  if (!useCommits) {
    const numbers = [
      ...new Set(
        merges
          .map((commit) => pullRequestNumber(commit.subject))
          .filter(Boolean)
      ),
    ];
    const pullRequests = fetchPullRequests(numbers);

    for (const commit of merges) {
      const number = pullRequestNumber(commit.subject);
      if (!number) continue;
      const pr = pullRequests.get(number);
      if (!pr) continue;

      if (isRollup(pr)) {
        rollups += 1;
        continue;
      }

      if (commit.parents.length > 1) {
        for (const hash of commitsIn([
          `${commit.parents[0]}..${commit.parents[1]}`,
        ])) {
          claimed.add(hash.hash);
        }
      }

      if (entries.some((entry) => entry.number === number)) continue;
      entries.push({
        kind: 'pr',
        number,
        ref: `#${number}`,
        url: pr.url,
        author: pr.author?.login ?? null,
        parsed: parseTitle(pr.title),
      });
    }
  }

  // Whatever the pull requests did not account for. In --commits mode that is
  // every non merge commit in the range, which is the offline shape of the
  // same question.
  for (const commit of commitsIn(range, ['--no-merges'])) {
    if (claimed.has(commit.hash)) continue;
    entries.push({
      kind: 'commit',
      ref: commit.hash.slice(0, 7),
      url: null,
      author: null,
      parsed: parseTitle(commit.subject),
    });
  }

  return { entries, rollups };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function label(entry, unit = null) {
  const { parsed } = entry;
  let scope = parsed.scopes.length ? `**${parsed.scopes.join(', ')}**: ` : '';
  if (unit && !scope) scope = '**no scope**: ';
  const link = entry.url ? `[${entry.ref}](${entry.url})` : entry.ref;
  return `- ${scope}${parsed.summary} (${link})`;
}

// Where the "Full changelog" link ends. Never HEAD: a release keeps its notes,
// and a link to HEAD grows to show every later change as part of that release.
// The version comes first because it names the release even when the notes are
// written before its tag exists.
function compareEnd({ to, version }) {
  if (version) return version;
  if (to && to !== 'HEAD') return to;
  return null;
}

function render({
  entries,
  rollups,
  from,
  to,
  version,
  all,
  repo,
  unit = null,
  otherUnits = 0,
}) {
  const lines = [];
  const shown = new Map();
  const broken = [];
  const hidden = [];

  for (const entry of entries) {
    if (!entry.parsed.ok) {
      // A pull request with a bad title is somebody's to fix, so it is named.
      // A loose commit with a bad subject is history, and only listed with --all.
      (entry.kind === 'pr' ? broken : hidden).push(entry);
      continue;
    }
    const section = sectionFor(entry.parsed);
    if (!section) {
      hidden.push(entry);
      continue;
    }
    if (!shown.has(section)) shown.set(section, []);
    shown.get(section).push(entry);
  }

  if (version) lines.push(`# ${version}`, '');

  for (const section of sectionOrder()) {
    const inSection = shown.get(section);
    if (!inSection?.length) continue;
    inSection.sort((a, b) => {
      const byScope = (a.parsed.scopes[0] ?? '').localeCompare(
        b.parsed.scopes[0] ?? ''
      );
      return byScope !== 0
        ? byScope
        : String(a.ref).localeCompare(String(b.ref));
    });
    lines.push(`## ${section}`, '');
    for (const entry of inSection) lines.push(label(entry, unit));
    lines.push('');
  }

  if (all && hidden.length) {
    lines.push('## Internal', '');
    for (const entry of hidden) {
      const parsed = entry.parsed;
      const text = parsed.ok
        ? label(entry, unit)
        : `- ${parsed.title} (${entry.ref})`;
      lines.push(text);
    }
    lines.push('');
  }

  if (broken.length) {
    lines.push('## Titles that do not follow the naming rules', '');
    lines.push(
      'These are left out of the sections above because their titles cannot be read.',
      'Rename them (a merged pull request can still be retitled) and run this again.',
      ''
    );
    for (const entry of broken) {
      lines.push(`- ${entry.ref}: \`${entry.parsed.title}\``);
      for (const error of entry.parsed.errors) lines.push(`  - ${error}`);
    }
    lines.push('');
  }

  const loose = entries.filter((entry) => entry.kind === 'commit').length;
  const pulls = entries.filter((entry) => entry.kind === 'pr').length;
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const counts = [
    plural(pulls, 'pull request', 'pull requests'),
    `${plural(loose, 'commit', 'commits')} outside a pull request`,
    `${plural(rollups, 'rollup', 'rollups')} skipped`,
  ];
  if (unit) counts.push(`${otherUnits} left out as another unit's`);
  lines.push(`<sub>${counts.join(', ')}.</sub>`, '');
  if (unit) {
    lines.push(
      `<sub>The notes of ${unit}: its own scopes, the workspace scopes, and titles with no scope, which every unit lists.</sub>`,
      ''
    );
  }

  const end = compareEnd({ to, version });
  if (repo && from && end) {
    lines.push(
      `**Full changelog**: https://github.com/${repo}/compare/${from}...${end}`,
      ''
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    all: false,
    audit: false,
    strict: false,
    json: false,
    commits: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case '--from':
        options.from = next();
        break;
      case '--to':
        options.to = next();
        break;
      case '--version':
        options.version = next();
        break;
      case '--unit':
        options.unit = next();
        break;
      case '--out':
        options.out = next();
        break;
      case '--check':
        // The value is optional so CI can pass an untrusted title through the
        // environment rather than the command line.
        options.check = argv[index + 1]?.startsWith('--') ? '' : (next() ?? '');
        break;
      case '--all':
      case '--audit':
      case '--strict':
      case '--json':
      case '--commits':
        options[arg.slice(2)] = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option \`${arg}\`.\n\n${USAGE}`);
    }
  }
  return options;
}

function checkOne(title, json) {
  const parsed = parseTitle(title);
  if (json) {
    console.log(JSON.stringify(parsed, null, 2));
    return parsed.ok ? 0 : 1;
  }
  if (parsed.ok) {
    console.log(`OK: ${parsed.title}`);
    return 0;
  }
  console.error(
    `This title does not follow the naming rules:\n\n  ${parsed.title || '(empty)'}\n`
  );
  for (const error of parsed.errors) console.error(`  - it ${error}`);
  console.error(
    [
      '',
      'The shape is:  type(scope): summary',
      `Types:  ${Object.keys(TYPES).join(', ')}`,
      `Scopes: ${SCOPES.join(', ')}`,
      'Mark a breaking change with `!` before the colon, as in `feat(luna)!: ...`.',
      'See CONTRIBUTING.md for the whole convention.',
    ].join('\n')
  );
  return 1;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  if (options.check !== undefined) {
    const title = options.check || process.env.PR_TITLE || '';
    return checkOne(title, options.json);
  }

  const unit = options.unit ?? null;
  let prefix = null;
  if (unit !== null) {
    if (!Object.hasOwn(UNITS, unit)) {
      console.error(
        `\`${unit}\` is not a deploy unit. Use one of: ${Object.keys(UNITS).join(', ')}`
      );
      return 2;
    }
    prefix = tagPrefix(unit);
    if (options.version && !isUnitTag(options.version, prefix)) {
      console.error(
        `--version ${options.version} is not a release of ${unit}. Its tags are ${prefix}X.Y.Z`
      );
      return 2;
    }
  }

  const to = options.to ?? 'HEAD';
  const from = options.from ?? previousTag(to, prefix) ?? null;
  if (unit !== null && from === null) {
    console.error(
      `No tag ${prefix}* comes before ${to}, so the notes of ${unit} have no start.\n` +
        'Pass --from <ref>, or push the seed tag that CONTRIBUTING.md ("The first tag of a unit") lists.'
    );
    return 2;
  }
  const toNamesRelease =
    options.to &&
    (prefix ? isUnitTag(options.to, prefix) : isReleaseTag(options.to));
  const version = options.version ?? (toNamesRelease ? options.to : null);

  const collected = collect({
    from,
    to,
    useCommits: options.commits,
  });
  const { rollups } = collected;
  const { entries, otherUnits } = filterForUnit(collected.entries, unit);
  const badTitles = entries.filter(
    (entry) => entry.kind === 'pr' && !entry.parsed.ok
  );

  if (options.audit) {
    if (options.json) {
      console.log(JSON.stringify({ from, to, offenders: badTitles }, null, 2));
    } else if (badTitles.length === 0) {
      console.log(
        `Every pull request title in ${from ?? 'the start of history'}..${to} follows the rules.`
      );
    } else {
      console.log(
        `Titles to fix in ${from ?? 'the start of history'}..${to}:\n`
      );
      for (const entry of badTitles) {
        console.log(`${entry.ref} ${entry.parsed.title}`);
        for (const error of entry.parsed.errors) console.log(`   it ${error}`);
        if (entry.url) console.log(`   ${entry.url}`);
        console.log('');
      }
    }
    return badTitles.length === 0 ? 0 : 1;
  }

  if (options.json) {
    const payload = {
      from,
      to,
      version,
      unit,
      rollups,
      otherUnits,
      entries: entries.map((entry) => ({
        kind: entry.kind,
        ref: entry.ref,
        url: entry.url,
        author: entry.author,
        section: sectionFor(entry.parsed),
        ...entry.parsed,
      })),
    };
    const text = JSON.stringify(payload, null, 2);
    if (options.out) writeFileSync(options.out, `${text}\n`);
    else console.log(text);
    return options.strict && badTitles.length ? 1 : 0;
  }

  if (from && !compareEnd({ to, version })) {
    console.error(
      'No "Full changelog" link: the range ends at HEAD, which moves on after the release.\n' +
        'Pass --version <tag> (or --to <tag>) to link the notes to the release tag.'
    );
  }

  const markdown = render({
    entries,
    rollups,
    from,
    to,
    version,
    all: options.all,
    repo: repoSlug(),
    unit,
    otherUnits,
  });

  if (options.out) {
    writeFileSync(options.out, `${markdown}\n`);
    console.error(`Wrote ${options.out}`);
  } else {
    console.log(markdown);
  }

  return options.strict && badTitles.length ? 1 : 0;
}

// Only when run as a command. The tests import this file for its parts, and an
// import must not start walking git history.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 2;
  }
}

export {
  belongsToUnit,
  collect,
  compareEnd,
  filterForUnit,
  isReleaseTag,
  isRollup,
  isUnitTag,
  label,
  main,
  parseArgs,
  previousTag,
  pullRequestNumber,
  render,
  tagPrefix,
};
