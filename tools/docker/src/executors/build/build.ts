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
    options.registry || process.env.DOCKER_REGISTRY || '';

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

  options.buildArgs = options.buildArgs || {};

  // Expose the executor's own context to the Dockerfile. These are the only build
  // args the executor injects itself; everything else is caller-provided.
  options.buildArgs.NX_APP = context.projectName;
  options.buildArgs.TARGET_REGISTRY = registry;

  // Forward selected environment variables as build args. The caller lists the names
  // in `forwardEnv`, so the executor stays generic: it does not know what any of them
  // mean, only that the project asked for them to reach the Dockerfile. An explicit
  // buildArg already set for the same name wins.
  for (const name of options.forwardEnv || []) {
    if (options.buildArgs[name] === undefined && process.env[name] !== undefined) {
      options.buildArgs[name] = process.env[name] as string;
    }
  }

  for (const [key, value] of Object.entries(options.buildArgs)) {
    if (value) {
      // Quote the value so build args containing shell/cmd delimiters survive (e.g.
      // a comma-separated value, which cmd.exe on Windows would otherwise split).
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

  // Which buildx cache backend to use. From the `cache` option or the
  // DOCKER_BUILD_CACHE env var (env lets CI pick it globally without editing
  // project.json), default `local`:
  //   local    (default) — a local dir cache, swapped into place after the build.
  //   gha                — GitHub Actions cache backend (type=gha). Needs the
  //                        docker-container buildx driver and the Actions runtime
  //                        env (ACTIONS_CACHE_URL / ACTIONS_RUNTIME_TOKEN).
  //   registry           — a `<image>:buildcache` image in the registry.
  //   none / off         — no cache (same as noCache).
  const cacheType = (
    options.cache ||
    process.env.DOCKER_BUILD_CACHE ||
    'local'
  ).toLowerCase();
  const cacheEnabled =
    !options.noCache && cacheType !== 'none' && cacheType !== 'off';

  // Cache export mode (from the `cacheMode` option or DOCKER_BUILD_CACHE_MODE env),
  // max default or min. `max` exports every intermediate layer; `min` exports only
  // the final image's layers.
  const cacheMode =
    (
      options.cacheMode ||
      process.env.DOCKER_BUILD_CACHE_MODE ||
      'max'
    ).toLowerCase() === 'min'
      ? 'min'
      : 'max';

  const { cacheCurrent, cacheNew } = getCachePaths(options.imageName);

  if (cacheEnabled && cacheType === 'gha') {
    // Scope keeps each image's cache separate. From the `cacheScope` option or the
    // DOCKER_BUILD_CACHE_SCOPE env, defaulting to the image name.
    const scope =
      options.cacheScope ||
      process.env.DOCKER_BUILD_CACHE_SCOPE ||
      options.imageName.replace(/[^a-zA-Z0-9_.-]/g, '-');
    buildCommandArr.push(`--cache-from=type=gha,scope=${scope}`);
    buildCommandArr.push(`--cache-to=type=gha,mode=${cacheMode},scope=${scope}`);
  } else if (cacheEnabled && cacheType === 'registry') {
    if (!registry) {
      console.warn(
        'Registry cache requested but no registry is configured; skipping build cache.'
      );
    } else {
      const ref = `${registry}${options.imageName}:buildcache`.toLowerCase();
      buildCommandArr.push(`--cache-from=type=registry,ref=${ref}`);
      buildCommandArr.push(
        `--cache-to=type=registry,mode=${cacheMode},ref=${ref}`
      );
    }
  } else if (cacheEnabled) {
    buildCommandArr.push(`--cache-from=type=local,src="${cacheCurrent}"`);
    buildCommandArr.push(
      `--cache-to=type=local,dest="${cacheNew}",mode=${cacheMode}`
    );
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
      // The image was just built and loaded above, so tell push not to build it
      // again (it otherwise rebuilds once per tag).
      await push({ ...options, skipBuild: true }, context);
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
