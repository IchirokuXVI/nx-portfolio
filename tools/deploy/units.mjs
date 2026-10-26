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
//   - a gate has no gate.sh or gate.env, or its gate.env is incomplete
//   - a gate's TRIGGERS or IMAGES names a project or an image that does not exist
//   - an e2e project is named by no gate's TRIGGERS, or by more than one (plan 0016)
//   - a gate directory is listed in no unit's GATES
//
// The chart rule stays quiet only in a workspace where no unit chart exists at
// all. The rendered Gateway hostnames need a render, so `provision-release.sh
// --check` asserts those.
//
// The two apps/docker projects (the builder and the nginx base image) are not
// units (plan 0014 D2). They are recognised by their type:static-docker and
// type:dynamic-docker tags, and the check never asks them for a deploy: tag.
//
// Usage:
//   node tools/deploy/units.mjs list              every unit as JSON
//   node tools/deploy/units.mjs projects <unit>   the projects of a unit, one per line
//   node tools/deploy/units.mjs check             exits 1 and names each problem
//   node tools/deploy/units.mjs endpoints <env>   https://<host> of every unit, one per line
//   node tools/deploy/units.mjs images [--json]   every deployable image, without a tag
//   node tools/deploy/units.mjs gates <unit> <affected>
//                                                 the gates to run, as a JSON matrix
//
// `affected` is a comma separated list of project names. A gate runs when one
// of its TRIGGERS is in it, or always when TRIGGERS is empty.
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

/** The fields of k8s/e2e/<gate>/gate.env. Only BROWSERS may not be empty. */
export const GATE_KEYS = ['HOSTS', 'TRIGGERS', 'BROWSERS', 'IMAGES'];
const BROWSERS = ['playwright', 'cypress', 'both', 'none'];

/** Where the pipelines push, as the docker executor reads DOCKER_REGISTRY. */
export const REGISTRY = 'ghcr.io/ichirokuxvi';

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
    const imageName =
      json.targets['build:docker']?.options?.imageName ??
      `nx-portfolio/${json.name}`;
    projects.push({
      name: json.name,
      file,
      image: imageName.toLowerCase(),
      units: tags
        .filter((tag) => tag.startsWith(TAG_PREFIX))
        .map((tag) => tag.slice(TAG_PREFIX.length)),
    });
  }
  return projects;
}

/** Every project name under apps/, deployable or not. */
export function allProjectNames(root) {
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return [];
  return projectFiles(appsDir)
    .map((path) => JSON.parse(readFileSync(path, 'utf8')).name)
    .filter(Boolean)
    .sort();
}

/** The e2e projects: the projects under apps/ whose name ends in -e2e. */
export const e2eProjects = (root) =>
  allProjectNames(root).filter((name) => name.endsWith('-e2e'));

/** Every directory under k8s/e2e that holds a gate.env, parsed. */
export function readGates(root) {
  const e2eDir = join(root, 'k8s', 'e2e');
  if (!existsSync(e2eDir)) return [];
  return readdirSync(e2eDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(e2eDir, entry.name, 'gate.env'))
    )
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      envFile: join(e2eDir, name, 'gate.env'),
      hasScript: existsSync(join(e2eDir, name, 'gate.sh')),
      ...parseUnitEnv(readFileSync(join(e2eDir, name, 'gate.env'), 'utf8')),
    }));
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
      } else if (!existsSync(join(gateDir, 'gate.env'))) {
        say(`GATES names ${gate}, and k8s/e2e/${gate} has no gate.env`);
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

  problems.push(...checkGates(root, units, projects));

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

/** The gate half of `check` (plan 0016 D3). */
function checkGates(root, units, projects) {
  const problems = [];
  const gates = readGates(root);
  const names = new Set(allProjectNames(root));
  const images = new Set(projects.map((p) => p.image.split('/').pop()));
  const listed = new Set(units.flatMap((unit) => words(unit.fields?.GATES)));
  const triggeredBy = new Map();

  for (const gate of gates) {
    const file = toPosix(relative(root, gate.envFile));
    const say = (problem) => problems.push(`${file}: ${problem}`);
    for (const lineNumber of gate.unreadable) {
      say(
        `line ${lineNumber} is neither a comment nor NAME="value", so it cannot be checked`
      );
    }
    const { fields } = gate;
    for (const key of GATE_KEYS) {
      if (fields[key] === undefined) say(`${key} is absent`);
    }
    if (fields.BROWSERS !== undefined && !BROWSERS.includes(fields.BROWSERS)) {
      say(
        `BROWSERS is "${fields.BROWSERS}", and it must be one of ${BROWSERS.join(', ')}`
      );
    }
    if (!gate.hasScript) say(`k8s/e2e/${gate.name}/gate.sh does not exist`);
    if (!listed.has(gate.name)) {
      say(`no unit lists ${gate.name} in GATES, so no pipeline runs it`);
    }
    for (const trigger of words(fields.TRIGGERS)) {
      if (!names.has(trigger)) {
        say(
          `TRIGGERS names ${trigger}, and no project under apps/ has that name`
        );
      }
      triggeredBy.set(trigger, [
        ...(triggeredBy.get(trigger) ?? []),
        gate.name,
      ]);
    }
    for (const image of words(fields.IMAGES)) {
      if (!images.has(image)) {
        say(
          `IMAGES names ${image}, and no deployable project builds that image`
        );
      }
    }
  }

  // An e2e project that no gate names never runs before a deploy, and one that
  // two gates name belongs to neither unit.
  if (gates.length > 0) {
    for (const project of e2eProjects(root)) {
      const by = triggeredBy.get(project) ?? [];
      if (by.length === 0) {
        problems.push(
          `${project} is an e2e project that no gate.env names in TRIGGERS, so no deploy runs it`
        );
      } else if (by.length > 1) {
        problems.push(
          `${project} is named in the TRIGGERS of ${by.length} gates (${by.join(', ')}). An e2e project belongs to one gate`
        );
      }
    }
  }
  return problems;
}

/** `https://<host>` for every host of every unit in one environment. */
export function endpoints(root, environment) {
  const key = `HOSTS_${environment.toUpperCase()}`;
  return listUnits(root).flatMap((unit) =>
    words(unit[key]).map((host) => `https://${host}`)
  );
}

/** Every deployable image, as `<registry>/<image>`, without a tag. */
export const imageRefs = (root) =>
  deployableProjects(root).map((project) => `${REGISTRY}/${project.image}`);

/**
 * The gates of one unit that `affected` triggers, in GATES order, as the
 * matrix of the pipeline's gate job. `e2e` lists the affected e2e projects
 * among the gate's TRIGGERS.
 */
export function gateMatrix(root, unitName, affected) {
  const unit = listUnits(root).find((u) => u.name === unitName);
  if (!unit) throw new Error(`${unitName} is not a unit`);
  const changed = new Set(affected);
  const gates = new Map(readGates(root).map((gate) => [gate.name, gate]));
  const matrix = [];
  for (const name of words(unit.GATES)) {
    const gate = gates.get(name);
    if (!gate) throw new Error(`k8s/e2e/${name}/gate.env does not exist`);
    const triggers = words(gate.fields.TRIGGERS);
    if (triggers.length > 0 && !triggers.some((t) => changed.has(t))) continue;
    matrix.push({
      gate: name,
      e2e: triggers
        .filter((t) => t.endsWith('-e2e') && changed.has(t))
        .join(','),
      hosts: gate.fields.HOSTS ?? '',
      browsers: gate.fields.BROWSERS ?? 'none',
      images: gate.fields.IMAGES ?? '',
    });
  }
  return matrix;
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
  if (command === 'endpoints') {
    if (!['staging', 'production'].includes(unitName)) {
      console.error('deploy units: endpoints takes staging or production');
      return 1;
    }
    for (const url of endpoints(root, unitName)) console.log(url);
    return 0;
  }
  if (command === 'images') {
    const refs = imageRefs(root);
    if (unitName === '--json') console.log(JSON.stringify(refs));
    else for (const ref of refs) console.log(ref);
    return 0;
  }
  if (command === 'gates') {
    const affected = (argv[2] ?? '').split(',').filter(Boolean);
    try {
      console.log(JSON.stringify(gateMatrix(root, unitName, affected)));
    } catch (error) {
      console.error(`deploy units: ${error.message}`);
      return 1;
    }
    return 0;
  }
  console.error(
    'usage: node tools/deploy/units.mjs list | projects <unit> | check | endpoints <env> | images [--json] | gates <unit> <affected>'
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
