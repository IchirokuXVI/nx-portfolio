// The deploy unit check, checked (k8s plan 0014).
//
// Each case is one way a unit or a tag can go wrong, built as a throwaway
// workspace, and each one must turn the check red. The last cases run the real
// workspace, so a change that breaks the registry fails here first.
//
//   node --test tools/deploy/units.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkUnits, deployableProjects, listUnits } from './units.mjs';

const CLI = fileURLToPath(new URL('./units.mjs', import.meta.url));
const REPO = join(dirname(CLI), '..', '..');

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const UNIT_ENV = {
  web: {
    UNIT: 'web',
    NAMESPACE: 'web',
    RELEASE_NAME: 'web',
    CHART: 'k8s/helm/web',
    TAG_PREFIX: 'web-v',
    GATES: 'web-gate',
    SECRETS: '',
    RELEASE_TASKS: 'false',
    HOSTS_STAGING: 'staging.example.test',
    HOSTS_PRODUCTION: 'example.test',
    BUILD_ENV_STAGING: 'BASE_URL=https://staging.example.test',
    BUILD_ENV_PRODUCTION: 'BASE_URL=https://example.test',
  },
  api: {
    UNIT: 'api',
    NAMESPACE: 'api',
    RELEASE_NAME: 'api',
    CHART: 'k8s/helm/api',
    TAG_PREFIX: 'api-v',
    GATES: 'api-gate',
    SECRETS: 'api-secrets',
    RELEASE_TASKS: 'true',
    HOSTS_STAGING: 'api.staging.example.test',
    HOSTS_PRODUCTION: 'api.example.test',
    BUILD_ENV_STAGING: 'API_URL=https://api.staging.example.test',
    BUILD_ENV_PRODUCTION: 'API_URL=https://api.example.test',
  },
};

const PROJECTS = {
  'apps/home': { name: 'home', tags: ['deploy:web'] },
  'apps/server/main': { name: 'server-main', tags: ['deploy:api'] },
  'apps/docker/base': {
    name: 'docker/base',
    tags: ['type:static-docker'],
  },
  'libs/ui': { name: 'ui', tags: [], docker: false },
};

const envText = (fields) =>
  Object.entries(fields)
    .map(([key, value]) => `${key}="${value}"`)
    .join('\n') + '\n';

/**
 * A throwaway workspace. `units` and `projects` override the complete fixture
 * by key; a null value removes the entry.
 */
function workspace({ units = {}, projects = {}, gates, raw = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deploy-units-'));
  roots.push(root);
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  for (const [name, fields] of Object.entries({ ...UNIT_ENV, ...units })) {
    if (fields === null) continue;
    write(`k8s/units/${name}/unit.env`, raw[name] ?? envText(fields));
  }
  for (const gate of gates ?? ['web-gate', 'api-gate']) {
    mkdirSync(join(root, 'k8s', 'e2e', gate), { recursive: true });
  }
  for (const [dir, project] of Object.entries({ ...PROJECTS, ...projects })) {
    if (project === null) continue;
    const targets =
      project.docker === false
        ? { build: {} }
        : { build: {}, 'build:docker': {} };
    write(
      `${dir}/project.json`,
      JSON.stringify({ name: project.name, targets, tags: project.tags })
    );
  }
  return root;
}

const expectProblem = (root, pattern) => {
  const problems = checkUnits(root);
  assert.ok(
    problems.some((problem) => pattern.test(problem)),
    `expected a problem matching ${pattern}, got:\n${problems.join('\n')}`
  );
};

test('a complete workspace passes', () => {
  assert.deepEqual(checkUnits(workspace()), []);
});

test('lists each unit with its fields and projects', () => {
  const units = listUnits(workspace());
  assert.deepEqual(
    units.map((unit) => [unit.name, unit.NAMESPACE, unit.projects]),
    [
      ['api', 'api', ['server-main']],
      ['web', 'web', ['home']],
    ]
  );
});

test('a workspace artifact needs no deploy tag', () => {
  const names = deployableProjects(workspace()).map((p) => p.name);
  assert.deepEqual(names, ['home', 'server-main']);
});

test('a deployable project with no deploy tag fails and names its file', () => {
  expectProblem(
    workspace({ projects: { 'apps/home': { name: 'home', tags: [] } } }),
    /^apps\/home\/project\.json: home has a build:docker target and no deploy:<unit> tag/
  );
});

test('a project with two deploy tags fails', () => {
  expectProblem(
    workspace({
      projects: {
        'apps/home': { name: 'home', tags: ['deploy:web', 'deploy:api'] },
      },
    }),
    /home carries 2 deploy tags/
  );
});

test('a tag that names no unit fails', () => {
  expectProblem(
    workspace({
      projects: {
        'apps/extra': { name: 'extra', tags: ['deploy:nowhere'] },
      },
    }),
    /extra is tagged deploy:nowhere, and k8s\/units\/nowhere\/unit\.env does not exist/
  );
});

test('a unit directory with no unit.env fails', () => {
  const root = workspace();
  mkdirSync(join(root, 'k8s', 'units', 'empty'));
  expectProblem(root, /^k8s\/units\/empty\/unit\.env: is absent/);
});

test('a unit with no project fails', () => {
  expectProblem(
    workspace({ projects: { 'apps/home': null } }),
    /k8s\/units\/web\/unit\.env: no project is tagged deploy:web/
  );
});

test('an absent key fails', () => {
  const { HOSTS_PRODUCTION, ...rest } = UNIT_ENV.web;
  expectProblem(
    workspace({ units: { web: rest } }),
    /web\/unit\.env: HOSTS_PRODUCTION is absent/
  );
});

test('an empty host list fails, and an empty SECRETS passes', () => {
  expectProblem(
    workspace({ units: { web: { ...UNIT_ENV.web, HOSTS_STAGING: '' } } }),
    /HOSTS_STAGING is empty/
  );
  assert.deepEqual(
    checkUnits(workspace({ units: { api: { ...UNIT_ENV.api, SECRETS: '' } } })),
    []
  );
});

test('a line that is not NAME="value" fails', () => {
  expectProblem(
    workspace({ raw: { web: envText(UNIT_ENV.web) + 'echo hello\n' } }),
    /web\/unit\.env: line 13 is neither a comment nor NAME="value"/
  );
});

test('UNIT must equal the directory name', () => {
  expectProblem(
    workspace({ units: { web: { ...UNIT_ENV.web, UNIT: 'site' } } }),
    /UNIT is "site", and the directory is web/
  );
});

test('RELEASE_TASKS must be true or false', () => {
  expectProblem(
    workspace({ units: { web: { ...UNIT_ENV.web, RELEASE_TASKS: 'yes' } } }),
    /RELEASE_TASKS is "yes"/
  );
});

test('a gate with no directory under k8s/e2e fails', () => {
  expectProblem(
    workspace({ gates: ['web-gate'] }),
    /api\/unit\.env: GATES names api-gate, and k8s\/e2e\/api-gate is not a directory/
  );
});

test('equal tag prefixes fail', () => {
  expectProblem(
    workspace({ units: { api: { ...UNIT_ENV.api, TAG_PREFIX: 'web-v' } } }),
    /share the TAG_PREFIX web-v/
  );
});

test('a tag prefix that starts another fails', () => {
  expectProblem(
    workspace({ units: { api: { ...UNIT_ENV.api, TAG_PREFIX: 'web-v2-' } } }),
    /overlap/
  );
});

test('the chart rule waits until one unit has a chart, then holds every unit to it', () => {
  const root = workspace();
  assert.deepEqual(checkUnits(root), []);
  mkdirSync(join(root, 'k8s', 'helm', 'web'), { recursive: true });
  writeFileSync(join(root, 'k8s', 'helm', 'web', 'Chart.yaml'), 'name: web\n');
  expectProblem(
    root,
    /api\/unit\.env: CHART is k8s\/helm\/api, and it holds no Chart\.yaml/
  );
});

test('the command exits 1 and names the file', () => {
  const root = workspace({
    projects: { 'apps/home': { name: 'home', tags: [] } },
  });
  const run = spawnSync(process.execPath, [CLI, 'check'], {
    env: { ...process.env, UNITS_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /apps\/home\/project\.json/);
});

test('projects prints one name per line, and an unknown unit fails', () => {
  const root = workspace();
  const env = { ...process.env, UNITS_ROOT: root };
  const known = spawnSync(process.execPath, [CLI, 'projects', 'web'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(known.status, 0);
  assert.equal(known.stdout, 'home\n');
  const unknown = spawnSync(process.execPath, [CLI, 'projects', 'nowhere'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(unknown.status, 1);
});

test('this workspace passes, with four portfolio and nine velista projects', () => {
  assert.deepEqual(checkUnits(REPO), []);
  const counts = Object.fromEntries(
    listUnits(REPO).map((unit) => [unit.name, unit.projects.length])
  );
  assert.deepEqual(counts, { portfolio: 4, velista: 9 });
});
