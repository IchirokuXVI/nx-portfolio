import { PromiseExecutor } from '@nx/devkit';
import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import push from '../push/push';
import { BuildExecutorSchema } from './schema';

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

  const registry = options.registry || process.env.PORTFOLIO_DOCKER_REGISTRY;
  const versionTag = options.versionTag;

  const dockerfile = options.dockerfile
    ? path.join(projectRoot, options.dockerfile)
    : path.join(projectRoot, 'src/Dockerfile');

  const mappedContexts = {
    project: projectRoot,
    root: context.root,
    dockerfile: path.dirname(dockerfile),
  } as const;

  const contextDir = mappedContexts[options.context];

  const fullImage = `${registry ? `${registry}/` : ''}${options.imageName}:${versionTag}`;

  const noCacheFlag = options.noCache ? ' --no-cache' : '';

  const buildArgs = [];

  if (!options.buildArgs.NODE_ENV && options.addNodeEnv) {
    options.buildArgs.NODE_ENV = process.env.NODE_ENV || 'development';
  }

  for (const [key, value] of Object.entries(options.buildArgs || {})) {
    buildArgs.push(`--build-arg ${key}=${value}`);
  }

  // noCacheFlag has no space after build because it includes the leading space in itself
  // do not add the space because the test will fail
  const buildCommand = [
    'docker build',
    noCacheFlag,
    `-f ${dockerfile}`,
    `-t ${fullImage}`,
    ...buildArgs,
    contextDir,
  ]
    .filter((v) => v)
    .join(' ');

  console.log(`Running command: ${buildCommand}`);

  try {
    const result = await execAsync(buildCommand);

    console.log(`Built image: ${fullImage}`);

    if (options.pushToRegistry) {
      push(options, context);
    }

    return {
      success: true,
    };
  } catch (err) {
    console.error('Error during Docker build: ', err);

    return {
      success: false,
    };
  }
};

export default runExecutor;
