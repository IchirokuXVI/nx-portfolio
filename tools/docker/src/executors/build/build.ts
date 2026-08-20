import { PromiseExecutor } from '@nx/devkit';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import * as path from 'path';
import push from '../push/push';
import { resolveVersionTags } from '../version-tags';
import { BuildExecutorSchema } from './schema';
import { simpleHash } from './simple-hash';

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

  // Alternative to MFE_BASE_URL: an explicit per-remote URL map (name=url,...) for
  // when each remote lives on its own origin/port (the local "port" mode). Also
  // baked into the shell only; other Dockerfiles do not declare the arg.
  if (!options.buildArgs.MFE_REMOTE_URLS && process.env.MFE_REMOTE_URLS) {
    options.buildArgs.MFE_REMOTE_URLS = process.env.MFE_REMOTE_URLS;
  }

  for (const [key, value] of Object.entries(options.buildArgs || {})) {
    if (value) {
      // Quote the value so build args containing shell/cmd delimiters survive — e.g.
      // MFE_REMOTE_URLS, whose commas would otherwise be split by cmd.exe on Windows.
      buildArgs.push(`--build-arg ${key}="${value}"`);
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

  // Which buildx cache backend to use, via PORTFOLIO_DOCKER_CACHE:
  //   local    (default) — a local dir cache, swapped into place after the build.
  //   gha                — GitHub Actions cache backend (type=gha). Needs the
  //                        docker-container buildx driver and the Actions runtime
  //                        env (ACTIONS_CACHE_URL / ACTIONS_RUNTIME_TOKEN).
  //   registry           — a `<image>:buildcache` image in the registry.
  //   none / off         — no cache (same as noCache).
  // Point 3 (mode=min vs mode=max) is intentionally left at mode=max for now; it
  // can be measured/tuned later. See MEMORY docker-build-cache-mode-min.
  const cacheType = (process.env.PORTFOLIO_DOCKER_CACHE || 'local').toLowerCase();
  const cacheEnabled =
    !options.noCache && cacheType !== 'none' && cacheType !== 'off';

  const { cacheCurrent, cacheNew } = getCachePaths(options.imageName);

  if (cacheEnabled && cacheType === 'gha') {
    // Scope keeps each image's cache separate. The scope can be overridden per
    // build (e.g. the builder keys its scope by the lockfile hash so its deps
    // cache is reused until dependencies actually change).
    const scope =
      process.env.PORTFOLIO_DOCKER_CACHE_SCOPE ||
      options.imageName.replace(/[^a-zA-Z0-9_.-]/g, '-');
    buildCommandArr.push(`--cache-from=type=gha,scope=${scope}`);
    buildCommandArr.push(`--cache-to=type=gha,mode=max,scope=${scope}`);
  } else if (cacheEnabled && cacheType === 'registry') {
    if (!registry) {
      console.warn(
        'PORTFOLIO_DOCKER_CACHE=registry but no registry is configured; skipping build cache.'
      );
    } else {
      const ref = `${registry}${options.imageName}:buildcache`.toLowerCase();
      buildCommandArr.push(`--cache-from=type=registry,ref=${ref}`);
      buildCommandArr.push(`--cache-to=type=registry,mode=max,ref=${ref}`);
    }
  } else if (cacheEnabled) {
    buildCommandArr.push(`--cache-from=type=local,src="${cacheCurrent}"`);
    buildCommandArr.push(`--cache-to=type=local,dest="${cacheNew}",mode=max`);
  }

  buildCommandArr.push(contextDir);

  buildCommandArr.push('--load');

  const buildCommand = buildCommandArr.filter((v) => v).join(' ');

  console.log(`Running command: ${buildCommand}`);

  try {
    // Stream buildx output straight through so its progress — including which
    // layers are CACHED — is visible in the (CI) logs.
    await runCommandStreaming(buildCommand);
  } catch (err: any) {
    throw new Error(`Error during Docker build: ${err.message}`);
  }

  console.log(`Built images: ${imagesToCreate.join(', ')}`);

  // Only the local cache backend uses the on-disk swap dance; gha/registry manage
  // their own storage.
  if (cacheEnabled && cacheType === 'local') {
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

/**
 * Run a shell command, streaming its stdout/stderr to this process so buildx
 * progress is visible live. Resolves on exit code 0, rejects otherwise.
 */
function runCommandStreaming(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`exited with code ${code}`));
      }
    });
  });
}

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
