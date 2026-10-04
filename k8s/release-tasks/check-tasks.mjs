#!/usr/bin/env node
// Every release task says when it can run, without a cluster to ask.
//
// A release task runs once per cluster, at the first deploy that carries it,
// and some of them delete data. `run-release-tasks.sh` refuses a task that
// states no window, but it only finds out on the VPS, in the middle of a
// deploy. This reads the same files on a pull request, where the cost of a
// refusal is a red check (k8s plan 0011, section 4).
//
// It fails when, for any `tasks/NNNN-*/`:
//
//   - a window (RUN_UNTIL_STAGING, RUN_UNTIL_PRODUCTION) is absent, empty, or
//     neither a date nor the word `never`
//   - RUN_UNTIL_PRODUCTION is a date and PRODUCTION_RELEASE is absent, or is not
//     a version written without its `v`
//   - a window is more than 14 days after the commit that last changed that
//     task.env. 14 days is how long the bucket keeps a dump, which is how long
//     a task stays reversible. Without a cap, somebody writes 2099
//   - check.sh is absent, or neither pre.sh nor post.sh exists
//   - ENVIRONMENTS is still set. The two windows replaced it
//   - two task directories share a number
//
// A window in the past is not a failure. Every task ends that way, and the file
// stays as the record of what ran.
//
// It reads task.env as text and never runs it. A line it cannot read as a
// comment or as `NAME="value"` is a failure, because bash would run that line
// and this file cannot know what it does.
//
// Usage:
//   node k8s/release-tasks/check-tasks.mjs [<tasks directory>]
//
// Exits 0 when every task is complete, 1 when any is not.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_WINDOW_DAYS = 14;

const WINDOWS = ['RUN_UNTIL_STAGING', 'RUN_UNTIL_PRODUCTION'];
const TASK_DIRECTORY = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASSIGNMENT =
  /^([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"$`\\]*)"|'([^']*)'|([A-Za-z0-9._:/+-]*))$/;
// What `deploy-release.sh` receives: the release tag without its `v`.
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The assignments of a task.env, and the lines that are neither a comment nor
 * an assignment this reader understands.
 */
export function parseTaskEnv(text) {
  const fields = {};
  const unreadable = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = ASSIGNMENT.exec(line);
    if (!match) {
      unreadable.push(index + 1);
      continue;
    }
    fields[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return { fields, unreadable };
}

/** The UTC midnight of a `YYYY-MM-DD` that is a real calendar day, or null. */
export function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  // Date.UTC rolls 2026-02-31 over into March, so the parts are read back.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return time;
}

/**
 * When a task.env last changed: the committer date of the last commit that
 * touched it, or now for a file with changes that no commit holds yet.
 *
 * In a shallow clone the oldest commit fetched appears to have written every
 * file, so the answer there is later than the truth and the cap is looser. The
 * pull request check clones the whole history, and that is where the cap bites.
 */
export function lastChangedInGit(file) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: dirname(file), encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', file);
  if (dirty !== '') return new Date();
  const stamp = git('log', '-1', '--format=%cI', '--', file);
  if (stamp === '') {
    throw new Error(`git knows no commit that changed ${file}`);
  }
  return new Date(stamp);
}

/**
 * Every problem in a tasks directory, as sentences. An empty list is a pass.
 *
 * `lastChanged` answers when a task.env last changed. The tests pass their own,
 * so a fixture needs no repository.
 */
export function checkTasks(tasksDir, { lastChanged = lastChangedInGit } = {}) {
  const problems = [];
  if (!existsSync(tasksDir)) {
    return [`${tasksDir} does not exist, so there is nothing to check`];
  }

  const names = readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  const byNumber = new Map();
  for (const name of names) {
    const match = TASK_DIRECTORY.exec(name);
    if (!match) {
      // The runner globs NNNN-*, so a directory under another name never runs.
      problems.push(
        `${name}: a task directory is named NNNN-kebab-title, so the runner would not see this one`
      );
      continue;
    }
    byNumber.set(match[1], [...(byNumber.get(match[1]) ?? []), name]);
  }
  for (const [number, sharing] of byNumber) {
    if (sharing.length > 1) {
      problems.push(
        `${sharing.join(' and ')} share the number ${number}. A number belongs to one task`
      );
    }
  }

  for (const name of names.filter((n) => TASK_DIRECTORY.test(n))) {
    const dir = join(tasksDir, name);
    const say = (problem) => problems.push(`${name}: ${problem}`);

    if (!existsSync(join(dir, 'check.sh'))) {
      say(
        'check.sh is absent, so the task states nothing about the data it expects'
      );
    }
    if (!existsSync(join(dir, 'pre.sh')) && !existsSync(join(dir, 'post.sh'))) {
      say('neither pre.sh nor post.sh exists, so the task does nothing');
    }

    const envFile = join(dir, 'task.env');
    if (!existsSync(envFile)) {
      say('task.env is absent');
      continue;
    }
    const { fields, unreadable } = parseTaskEnv(readFileSync(envFile, 'utf8'));
    for (const lineNumber of unreadable) {
      say(
        `task.env line ${lineNumber} is neither a comment nor NAME="value", so it cannot be checked`
      );
    }
    if ('ENVIRONMENTS' in fields) {
      say(
        'ENVIRONMENTS is still set. RUN_UNTIL_STAGING and RUN_UNTIL_PRODUCTION replaced it'
      );
    }

    const days = {};
    for (const window of WINDOWS) {
      const value = fields[window];
      if (value === undefined) {
        say(`${window} is absent. State a date (YYYY-MM-DD) or the word never`);
      } else if (value === '') {
        say(`${window} is empty. State a date (YYYY-MM-DD) or the word never`);
      } else if (value !== 'never') {
        const day = parseDay(value);
        if (day === null) {
          say(
            `${window} is "${value}", which is neither a date (YYYY-MM-DD) nor the word never`
          );
        } else {
          days[window] = day;
        }
      }
    }

    if (
      fields.RUN_UNTIL_PRODUCTION !== undefined &&
      days.RUN_UNTIL_PRODUCTION !== undefined
    ) {
      const release = fields.PRODUCTION_RELEASE;
      if (release === undefined || release === '') {
        say(
          'RUN_UNTIL_PRODUCTION is a date and PRODUCTION_RELEASE is absent. Production runs a task in one release only'
        );
      } else if (!VERSION.test(release)) {
        say(
          `PRODUCTION_RELEASE is "${release}", which is not a version as deploy-release.sh receives it (1.2.3, without the v)`
        );
      }
    }

    if (Object.keys(days).length > 0) {
      let changed;
      try {
        changed = lastChanged(envFile);
      } catch (error) {
        say(`cannot tell when task.env last changed: ${error.message}`);
        continue;
      }
      const changedDay = Date.UTC(
        changed.getUTCFullYear(),
        changed.getUTCMonth(),
        changed.getUTCDate()
      );
      for (const [window, day] of Object.entries(days)) {
        const ahead = Math.round((day - changedDay) / DAY);
        if (ahead > MAX_WINDOW_DAYS) {
          say(
            `${window} is ${ahead} days after task.env last changed (${new Date(changedDay).toISOString().slice(0, 10)}). The limit is ${MAX_WINDOW_DAYS} days, which is how long a dump is kept`
          );
        }
      }
    }
  }

  return problems;
}

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const tasksDir = resolve(argv[0] ?? join(here, 'tasks'));
  const problems = checkTasks(tasksDir);
  if (problems.length > 0) {
    console.error(
      `release tasks: ${problems.length} problem(s) in ${tasksDir}`
    );
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  const count = readdirSync(tasksDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && TASK_DIRECTORY.test(entry.name)
  ).length;
  console.log(
    `release tasks: ${count} checked, each one states its windows, its release and a check.sh`
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
