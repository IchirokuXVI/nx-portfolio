// The release task check, checked.
//
// A gate that cannot fail is not a gate. Each case below is one way a task can
// leave out what k8s plan 0011 makes it state, with one fixture for each, and
// each one must turn the check red.
//
// The fixtures are throwaway directories, so the suite needs no cluster. Most
// of them pass their own answer to "when did this task.env last change", so
// they need no repository either. The last two cases commit a fixture to a
// repository of their own, which proves that the real answer is read from git.
//
//   node --test k8s/release-tasks/check-tasks.test.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkTasks, parseDay, parseTaskEnv } from './check-tasks.mjs';

const CHECKER = fileURLToPath(new URL('./check-tasks.mjs', import.meta.url));

// Every fixture was "last changed" on this day unless it says otherwise.
const CHANGED = new Date('2026-10-03T10:00:00Z');
const lastChanged = () => CHANGED;

const COMPLETE = {
  RUN_UNTIL_STAGING: '2026-10-10',
  RUN_UNTIL_PRODUCTION: '2026-10-17',
  PRODUCTION_RELEASE: '0.6.0',
  DATABASES: 'catalog harvester core',
};

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A throwaway tasks directory.
 *
 * `tasks` maps a directory name to `{ env, files }`. `env` is the fields of its
 * task.env (a string is written as it is, and null leaves the file out), and
 * `files` is the hooks it holds. Returns the directory path.
 */
function tasksDir(tasks) {
  const root = mkdtempSync(join(tmpdir(), 'release-tasks-'));
  roots.push(root);
  for (const [name, task] of Object.entries(tasks)) {
    const dir = join(root, name);
    mkdirSync(dir);
    const { env = COMPLETE, files = ['check.sh', 'post.sh'] } = task;
    if (env !== null) {
      const text =
        typeof env === 'string'
          ? env
          : Object.entries(env)
              .map(([key, value]) => `${key}="${value}"\n`)
              .join('');
      writeFileSync(join(dir, 'task.env'), text);
    }
    for (const file of files)
      writeFileSync(join(dir, file), '#!/usr/bin/env bash\n');
  }
  return root;
}

/** The problems of one task whose task.env is COMPLETE with some fields changed. */
function problemsWith(changes, files) {
  const env = { ...COMPLETE, ...changes };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return checkTasks(tasksDir({ '0001-a-task': { env, files } }), {
    lastChanged,
  });
}

function assertOneProblem(problems, pattern) {
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], pattern);
}

test('passes a task that states both windows, its release and a check', () => {
  assert.deepEqual(problemsWith({}), []);
});

test('passes a window in the past, which is how every task ends', () => {
  assert.deepEqual(
    problemsWith({
      RUN_UNTIL_STAGING: '2026-09-25',
      RUN_UNTIL_PRODUCTION: '2026-09-25',
    }),
    []
  );
});

test('passes a task that never runs in production and names no release', () => {
  assert.deepEqual(
    problemsWith({
      RUN_UNTIL_PRODUCTION: 'never',
      PRODUCTION_RELEASE: undefined,
    }),
    []
  );
});

test('fails on a window that is absent', () => {
  assertOneProblem(
    problemsWith({ RUN_UNTIL_STAGING: undefined }),
    /0001-a-task: RUN_UNTIL_STAGING is absent/
  );
});

test('fails on a window that is empty', () => {
  assertOneProblem(
    problemsWith({ RUN_UNTIL_STAGING: '' }),
    /0001-a-task: RUN_UNTIL_STAGING is empty/
  );
});

test('fails on a window that is neither a date nor never', () => {
  assertOneProblem(
    problemsWith({ RUN_UNTIL_STAGING: 'soon' }),
    /RUN_UNTIL_STAGING is "soon", which is neither a date/
  );
});

test('fails on a window that is not a real day', () => {
  assertOneProblem(
    problemsWith({ RUN_UNTIL_STAGING: '2026-02-31' }),
    /RUN_UNTIL_STAGING is "2026-02-31", which is neither a date/
  );
});

test('fails on a production date with no production release', () => {
  assertOneProblem(
    problemsWith({ PRODUCTION_RELEASE: undefined }),
    /RUN_UNTIL_PRODUCTION is a date and PRODUCTION_RELEASE is absent/
  );
});

test('fails on a production release written with its v', () => {
  assertOneProblem(
    problemsWith({ PRODUCTION_RELEASE: 'v0.6.0' }),
    /PRODUCTION_RELEASE is "v0\.6\.0", which is not a version/
  );
});

test('fails on a window more than 14 days after the task.env last changed', () => {
  // Changed on 2026-10-03, so 2026-10-17 is day 14 and 2026-10-18 is day 15.
  assert.deepEqual(problemsWith({ RUN_UNTIL_PRODUCTION: '2026-10-17' }), []);
  assertOneProblem(
    problemsWith({ RUN_UNTIL_PRODUCTION: '2026-10-18' }),
    /RUN_UNTIL_PRODUCTION is 15 days after task\.env last changed \(2026-10-03\)/
  );
});

test('fails when nothing can say when the task.env last changed', () => {
  const dir = tasksDir({ '0001-a-task': {} });
  const problems = checkTasks(dir, {
    lastChanged: () => {
      throw new Error('no history');
    },
  });
  assertOneProblem(
    problems,
    /cannot tell when task\.env last changed: no history/
  );
});

test('fails on a task with no check.sh', () => {
  assertOneProblem(
    problemsWith({}, ['pre.sh']),
    /0001-a-task: check\.sh is absent/
  );
});

test('fails on a task with neither pre.sh nor post.sh', () => {
  assertOneProblem(
    problemsWith({}, ['check.sh']),
    /0001-a-task: neither pre\.sh nor post\.sh exists/
  );
});

test('fails on a task that still sets ENVIRONMENTS', () => {
  assertOneProblem(
    problemsWith({ ENVIRONMENTS: 'staging production' }),
    /0001-a-task: ENVIRONMENTS is still set/
  );
});

test('fails on two task directories that share a number', () => {
  const dir = tasksDir({
    '0001-a-task': {},
    '0001-another-task': {},
    '0002-a-third': {},
  });
  assertOneProblem(
    checkTasks(dir, { lastChanged }),
    /0001-a-task and 0001-another-task share the number 0001/
  );
});

test('fails on a task with no task.env', () => {
  const dir = tasksDir({ '0001-a-task': { env: null } });
  assertOneProblem(
    checkTasks(dir, { lastChanged }),
    /0001-a-task: task\.env is absent/
  );
});

test('fails on a task.env line it cannot read without running it', () => {
  const env = [
    '# a comment',
    'RUN_UNTIL_STAGING="2026-10-10"',
    'RUN_UNTIL_PRODUCTION="$(date +%F)"',
    'PRODUCTION_RELEASE="0.6.0"',
    '',
  ].join('\n');
  const problems = checkTasks(tasksDir({ '0001-a-task': { env } }), {
    lastChanged,
  });
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(
    problems[0],
    /task\.env line 3 is neither a comment nor NAME="value"/
  );
  assert.match(problems[1], /RUN_UNTIL_PRODUCTION is absent/);
});

test('fails on a directory the runner would not see', () => {
  const dir = tasksDir({ '0001-a-task': {}, 'reset-everything': {} });
  assertOneProblem(
    checkTasks(dir, { lastChanged }),
    /reset-everything: a task directory is named/
  );
});

test('reads a task.env with CRLF line endings, comments and three kinds of value', () => {
  const { fields, unreadable } = parseTaskEnv(
    '# a comment\r\nA="one two"\r\nB=\'three\'\r\nC=never\r\n\r\nD=""\r\n'
  );
  assert.deepEqual(fields, { A: 'one two', B: 'three', C: 'never', D: '' });
  assert.deepEqual(unreadable, []);
});

test('reads a day only when the calendar holds it', () => {
  assert.equal(parseDay('2026-10-03'), Date.UTC(2026, 9, 3));
  assert.equal(parseDay('2028-02-29'), Date.UTC(2028, 1, 29));
  assert.equal(parseDay('2026-02-29'), null);
  assert.equal(parseDay('2026-13-01'), null);
  assert.equal(parseDay('2026-1-1'), null);
});

/**
 * A repository holding one task, whose task.env was committed on `committedOn`.
 * Returns its tasks directory.
 */
function committedTask(env, committedOn) {
  const root = tasksDir({ '0001-a-task': { env: { ...COMPLETE, ...env } } });
  const stamp = `${committedOn}T12:00:00Z`;
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: stamp,
        GIT_COMMITTER_DATE: stamp,
        GIT_AUTHOR_NAME: 'fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    });
  git('init', '--quiet');
  git('add', '.');
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    'a task'
  );
  return root;
}

function run(dir) {
  const result = spawnSync(process.execPath, [CHECKER, dir], {
    encoding: 'utf8',
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test('the command measures the 14 days from the commit that last changed task.env', () => {
  // Committed on 2026-01-01 with a window on 2026-01-15, which is day 14. The
  // window is long past today, so only the commit date can make this pass.
  const dir = committedTask(
    { RUN_UNTIL_STAGING: '2026-01-15', RUN_UNTIL_PRODUCTION: '2026-01-15' },
    '2026-01-01'
  );
  const result = run(dir);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /release tasks: 1 checked/);
});

test('the command exits 1 and names the task when the window is past the cap', () => {
  const dir = committedTask(
    { RUN_UNTIL_STAGING: '2026-01-15', RUN_UNTIL_PRODUCTION: '2026-01-16' },
    '2026-01-01'
  );
  const result = run(dir);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.stderr,
    /0001-a-task: RUN_UNTIL_PRODUCTION is 15 days after task\.env last changed \(2026-01-01\)/
  );
  assert.doesNotMatch(result.stderr, /RUN_UNTIL_STAGING/);
});
