import { PromiseExecutor } from '@nx/devkit';
import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import push from '../push/push';
import { resolveVersionTags } from '../version-tags';
import { BuildExecutorSchema } from './schema';
import { simpleHash } from './simple-hash';

const execAsync = promisify(exec);

const runExecutor: PromiseExecutor<BuildExecutorSchema> = async (
  options,
  context
) => {
  console.log('Executor ran for Build', options);

  if (!context.projectName) {
    throw new Error(
      'Docker build executor requires a project name. ' +
        'Make sure you run it as part of an Nx project target (e.g. nx run myapp:build).'
    );
  }

  const project = context.projectsConfigurations?.projects[context.projectName];

  if (!project) {
    throw new Error(`Project ${context.projectName} not found.`);
  }

  const projectRoot = path.join(context.root, project.root);

  let registry =
    options.registry || process.env.PORTFOLIO_DOCKER_REGISTRY || '';

  if (registry && !registry.endsWith('/')) {
    registry += '/';
  }

  const versionTags = resolveVersionTags(options.versionTags);

  const dockerfile = options.dockerfile
    ? path.join(projectRoot, options.dockerfile)
    : path.join(projectRoot, 'src/Dockerfile');

  const mappedContexts = {
    project: projectRoot,
    root: context.root,
    dockerfile: path.dirname(dockerfile),
  } as const;

  const contextDir = mappedContexts[options.context];

  const buildArgs = [];

  if (!options.buildArgs.NODE_ENV) {
    options.buildArgs.NODE_ENV = process.env.NODE_ENV || 'development';
  }

  options.buildArgs.NX_APP = context.projectName;
  options.buildArgs.TARGET_REGISTRY = registry;

  // Which builder / local-http-server base image tag to build FROM. An explicit
  // per-configuration buildArg wins; otherwise fall back to the PORTFOLIO_BUILDER_TAG
  // environment variable, otherwise the Dockerfile default (latest). This lets a
  // build pick the dev tag, a release tag, or a specific commit without editing
  // project.json (e.g. PORTFOLIO_BUILDER_TAG=dev nx run landing:build:docker).
  if (!options.buildArgs.BUILDER_TAG && process.env.PORTFOLIO_BUILDER_TAG) {
    options.buildArgs.BUILDER_TAG = process.env.PORTFOLIO_BUILDER_TAG;
  }

  // The shell embeds the micro-frontend base URL at build time, so it differs per
  // environment (staging vs production). Pass it through from the environment when
  // set; non-shell Dockerfiles simply do not declare the arg.
  if (!options.buildArgs.MFE_BASE_URL && process.env.MFE_BASE_URL) {
    options.buildArgs.MFE_BASE_URL = process.env.MFE_BASE_URL;
  }

  for (const [key, value] of Object.entries(options.buildArgs || {})) {
    if (value) {
      buildArgs.push(`--build-arg ${key}=${value}`);
    }
  }

  const imagesToCreate = versionTags.map((tag) =>
    `${registry ? `${registry}` : ''}${options.imageName}:${tag}`.toLowerCase()
  );

  const buildCommandArr = [];

  buildCommandArr.push('docker buildx build');

  if (options.noCache) {
    buildCommandArr.push('--no-cache');
  }

  buildCommandArr.push(`-f ${dockerfile}`);

  imagesToCreate.forEach((image) => {
    buildCommandArr.push(`-t ${image}`);
  });

  buildCommandArr.push(buildArgs.join(' '));

  const { cacheCurrent, cacheNew } = getCachePaths(options.imageName);

  if (!options.noCache) {
    buildCommandArr.push(`--cache-from=type=local,src="${cacheCurrent}"`);

    buildCommandArr.push(`--cache-to=type=local,dest="${cacheNew}",mode=max`);
  }

  buildCommandArr.push(contextDir);

  buildCommandArr.push('--load');

  const buildCommand = buildCommandArr.filter((v) => v).join(' ');

  console.log(`Running command: ${buildCommand}`);

  try {
    await execAsync(buildCommand);
  } catch (err: any) {
    throw new Error(`Error during Docker build: ${err.message}`);
  }

  console.log(`Built images: ${imagesToCreate.join(', ')}`);

  if (!options.noCache) {
    try {
      await fs.rm(cacheCurrent, { recursive: true, force: true });
      await fs.mkdir(path.dirname(cacheCurrent), { recursive: true });
      await fs.rename(cacheNew, cacheCurrent);
    } catch (err: any) {
      console.warn(`Error moving new cache into place: ${err.message}`);
    }
  }

  if (options.pushToRegistry) {
    try {
      await push(options, context);
    } catch (err: any) {
      throw new Error(`Error during Docker push: ${err.message}`);
    }
  }

  return {
    success: true,
  };
};

function getCachePaths(imageName: string) {
  const baseTmp = path.join(os.tmpdir(), 'docker-cache');
  const cacheCurrent = path.join(baseTmp, `.buildx-${simpleHash(imageName)}`);
  const cacheNew = path.join(
    baseTmp,
    `..`,
    'docker-cache-new',
    `.buildx-${simpleHash(imageName)}`
  );
  return { baseTmp, cacheCurrent, cacheNew };
}

export default runExecutor;
