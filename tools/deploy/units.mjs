#!/usr/bin/env node
// The deploy units of this workspace, and the check that keeps them whole
// (k8s plan 0014).
//
// A unit is declared in two places. The tag `deploy:<unit>` on a project.json
// names the unit of an app, and Nx can query it with --affected. The file
// `k8s/units/<unit>/unit.env` names the namespace, the release, the chart, the
// gates and the hosts, and a Bash script on a host can source it with no Nx.
// This file reads both as text, so it needs no Nx daemon, no Helm and no network.
//
// `check` fails when:
//
//   - a project with a build:docker target carries no deploy: tag, or more than one
//   - a deploy: tag names a unit with no k8s/units/<unit>/unit.env
//   - a unit has no project
//   - a unit.env line is neither a comment nor NAME="value"
//   - a required key is absent, or empty where it must not be (only SECRETS may be empty)
//   - UNIT differs from the directory name, or RELEASE_TASKS is neither true nor false
//   - a GATES entry names no directory under k8s/e2e
//   - two TAG_PREFIX values are equal, or one starts with the other
//   - a CHART directory has no Chart.yaml, once any unit's chart has one
//
// The last rule waits for plan 0015, which creates k8s/helm/<unit>. While no unit
// chart exists it is skipped; the first Chart.yaml turns it on for every unit.
// Plan 0016 adds the rule that every e2e project is named by exactly one gate.
//
// The two apps/docker projects (the builder and the nginx base image) are not
// units (plan 0014 D2). They are recognised by their type:static-docker and
// type:dynamic-docker tags, and the check never asks them for a deploy: tag.
//
// Usage:
//   node tools/deploy/units.mjs list              every unit as JSON
//   node tools/deploy/units.mjs projects <unit>   the projects of a unit, one per line
//   node tools/deploy/units.mjs check             exits 1 and names each problem
//
// UNITS_ROOT points the commands at another workspace root. The tests use it.

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTaskEnv } from '../../k8s/release-tasks/check-tasks.mjs';

export const TAG_PREFIX = 'deploy:';

export const REQUIRED_KEYS = [
  'UNIT',
  'NAMESPACE',
  'RELEASE_NAME',
  'CHART',
  'TAG_PREFIX',
  'GATES',
  'SECRETS',
  'RELEASE_TASKS',
  'HOSTS_STAGING',
  'HOSTS_PRODUCTION',
  'BUILD_ENV_STAGING',
  'BUILD_ENV_PRODUCTION',
];

/** A unit with no Secret of its own, such as the portfolio, states SECRETS="". */
const MAY_BE_EMPTY = new Set(['SECRETS']);

const WORKSPACE_ARTIFACT_TAGS = ['type:static-docker', 'type:dynamic-docker'];

/** unit.env has the format of a release task's task.env, so one reader serves both. */
export const parseUnitEnv = parseTaskEnv;

const toPosix = (path) => path.split(sep).join('/');

function projectFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...projectFiles(path));
    else if (entry.name === 'project.json') found.push(path);
  }
  return found;
}

/**
 * Every project under apps/ that builds an image and is not a workspace
 * artifact, with its deploy: tags. `file` is relative to the root, so a
 * problem names the file a person opens.
 */
export function deployableProjects(root) {
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return [];
  const projects = [];
  for (const path of projectFiles(appsDir).sort()) {
    const file = toPosix(relative(root, path));
    const json = JSON.parse(readFileSync(path, 'utf8'));
    if (!json.targets || !Object.hasOwn(json.targets, 'build:docker')) continue;
    const tags = json.tags ?? [];
    if (tags.some((tag) => WORKSPACE_ARTIFACT_TAGS.includes(tag))) continue;
    projects.push({
      name: json.name,
      file,
      units: tags
        .filter((tag) => tag.startsWith(TAG_PREFIX))
        .map((tag) => tag.slice(TAG_PREFIX.length)),
    });
  }
  return projects;
}

/** Every directory under k8s/units, with its parsed unit.env when one exists. */
export function readUnits(root) {
  const unitsDir = join(root, 'k8s', 'units');
  if (!existsSync(unitsDir)) return [];
  return readdirSync(unitsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const envFile = join(unitsDir, name, 'unit.env');
      if (!existsSync(envFile)) return { name, envFile, fields: null };
      return {
        name,
        envFile,
        ...parseUnitEnv(readFileSync(envFile, 'utf8')),
      };
    });
}

/** The units with their projects, as `list` prints them. */
export function listUnits(root) {
  const projects = deployableProjects(root);
  return readUnits(root)
    .filter((unit) => unit.fields !== null)
    .map((unit) => ({
      name: unit.name,
      ...unit.fields,
      projects: projects
        .filter((project) => project.units.includes(unit.name))
        .map((project) => project.name),
    }));
}

const words = (value) => (value ?? '').split(/\s+/).filter(Boolean);

/** Every problem in the workspace at `root`, as sentences. An empty list is a pass. */
export function checkUnits(root) {
  const problems = [];
  const units = readUnits(root);
  const projects = deployableProjects(root);
  const declared = new Set(
    units.filter((unit) => unit.fields !== null).map((unit) => unit.name)
  );

  if (units.length === 0) {
    problems.push('k8s/units holds no unit, so no app has a place to deploy');
  }

  for (const project of projects) {
    const say = (problem) =>
      problems.push(`${project.file}: ${project.name} ${problem}`);
    if (project.units.length === 0) {
      say(
        `has a build:docker target and no ${TAG_PREFIX}<unit> tag, so no deploy ships it`
      );
    } else if (project.units.length > 1) {
      say(
        `carries ${project.units.length} deploy tags (${project.units.join(', ')}). An app ships with one unit`
      );
    }
    for (const unit of project.units) {
      if (!declared.has(unit)) {
        say(
          `is tagged ${TAG_PREFIX}${unit}, and k8s/units/${unit}/unit.env does not exist`
        );
      }
    }
  }

  const chartsOn = units.some(
    (unit) =>
      unit.fields?.CHART &&
      existsSync(join(root, unit.fields.CHART, 'Chart.yaml'))
  );

  for (const unit of units) {
    const file = toPosix(relative(root, unit.envFile));
    const say = (problem) => problems.push(`${file}: ${problem}`);
    if (unit.fields === null) {
      say('is absent, so the directory declares no unit');
      continue;
    }
    for (const lineNumber of unit.unreadable) {
      say(
        `line ${lineNumber} is neither a comment nor NAME="value", so it cannot be checked`
      );
    }
    const { fields } = unit;
    for (const key of REQUIRED_KEYS) {
      if (fields[key] === undefined) say(`${key} is absent`);
      else if (fields[key] === '' && !MAY_BE_EMPTY.has(key)) {
        say(`${key} is empty`);
      }
    }
    if (fields.UNIT && fields.UNIT !== unit.name) {
      say(`UNIT is "${fields.UNIT}", and the directory is ${unit.name}`);
    }
    if (
      fields.RELEASE_TASKS !== undefined &&
      fields.RELEASE_TASKS !== '' &&
      !['true', 'false'].includes(fields.RELEASE_TASKS)
    ) {
      say(
        `RELEASE_TASKS is "${fields.RELEASE_TASKS}", and it must be true or false`
      );
    }
    for (const gate of words(fields.GATES)) {
      const gateDir = join(root, 'k8s', 'e2e', gate);
      if (!existsSync(gateDir) || !statSync(gateDir).isDirectory()) {
        say(`GATES names ${gate}, and k8s/e2e/${gate} is not a directory`);
      }
    }
    if (
      chartsOn &&
      fields.CHART &&
      !existsSync(join(root, fields.CHART, 'Chart.yaml'))
    ) {
      say(`CHART is ${fields.CHART}, and it holds no Chart.yaml`);
    }
    if (!projects.some((project) => project.units.includes(unit.name))) {
      say(
        `no project is tagged ${TAG_PREFIX}${unit.name}, so the unit deploys nothing`
      );
    }
  }

  // A release tag is matched by prefix, so velista-v must never also match a
  // tag of another unit.
  const prefixed = units.filter((unit) => unit.fields?.TAG_PREFIX);
  for (const [i, a] of prefixed.entries()) {
    for (const b of prefixed.slice(i + 1)) {
      const pa = a.fields.TAG_PREFIX;
      const pb = b.fields.TAG_PREFIX;
      if (pa === pb) {
        problems.push(
          `${a.name} and ${b.name} share the TAG_PREFIX ${pa}. A release tag must name one unit`
        );
      } else if (pa.startsWith(pb) || pb.startsWith(pa)) {
        problems.push(
          `the TAG_PREFIX of ${a.name} (${pa}) and of ${b.name} (${pb}) overlap, so a tag of one also matches the other`
        );
      }
    }
  }

  return problems;
}

function main(argv, root) {
  const [command, unitName] = argv;
  if (command === 'list') {
    console.log(JSON.stringify(listUnits(root), null, 2));
    return 0;
  }
  if (command === 'projects') {
    const unit = listUnits(root).find((u) => u.name === unitName);
    if (!unit) {
      console.error(
        unitName
          ? `deploy units: ${unitName} is not a unit. k8s/units/${unitName}/unit.env does not exist`
          : 'deploy units: name a unit, for example `projects velista`'
      );
      return 1;
    }
    for (const project of unit.projects) console.log(project);
    return 0;
  }
  if (command === 'check') {
    const problems = checkUnits(root);
    if (problems.length > 0) {
      console.error(`deploy units: ${problems.length} problem(s)`);
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }
    const units = listUnits(root);
    const summary = units
      .map((unit) => `${unit.name} (${unit.projects.length})`)
      .join(', ');
    console.log(
      `deploy units: ${units.length} checked, ${summary}. Every deployable project belongs to one`
    );
    return 0;
  }
  console.error(
    'usage: node tools/deploy/units.mjs list | projects <unit> | check'
  );
  return 1;
}

// Real paths are compared for the reason check-tasks.mjs gives: under a
// symlinked checkout the two spellings differ, and the command would do nothing.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const root = resolve(
    process.env.UNITS_ROOT ??
      join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  );
  process.exitCode = main(process.argv.slice(2), root);
}
