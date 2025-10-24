import { PromiseExecutor } from '@nx/devkit';
import { exec } from 'child_process';
import { promisify } from 'util';
import build from '../build/build';
import { PushExecutorSchema } from './schema';

const execAsync = promisify(exec);

const runExecutor: PromiseExecutor<PushExecutorSchema> = async (
  options,
  context
) => {
  console.log('Executor ran for Push', options);

  if (!context.projectName) {
    throw new Error(
      'Docker push executor requires a project name. ' +
        'Make sure you run it as part of an Nx project target (e.g. nx run myapp:push).'
    );
  }

  const project = context.projectsConfigurations?.projects[context.projectName];

  if (!project) {
    throw new Error(`Project ${context.projectName} not found.`);
  }

  const { imageName, versionTag } = options;
  const registry = options.registry || process.env.PORTFOLIO_DOCKER_REGISTRY;

  const skipLogin =
    options.skipLogin || process.env.PORTFOLIO_DOCKER_SKIP_LOGIN === 'true';

  const username = process.env.PORTFOLIO_DOCKER_USERNAME;
  const password = process.env.PORTFOLIO_DOCKER_PASSWORD;

  if (!registry || (!skipLogin && !username) || !password) {
    throw new Error(
      `Missing required Docker configuration:
      DOCKER_REGISTRY=${registry || '(unset)'}
      DOCKER_USERNAME=${username ? '(set)' : skipLogin ? '(skipped)' : '(unset)'}
      DOCKER_PASSWORD=${password ? '(set)' : skipLogin ? '(skipped)' : '(unset)'}`
    );
  }

  const fullImage = `${registry}/${imageName}:${versionTag}`;

  console.log(`Checking for local image: ${fullImage}`);

  // Check if image exists locally
  let imageExists = false;
  try {
    await execAsync(`docker image inspect ${fullImage}`);
    imageExists = true;
    console.log(`Image ${fullImage} already built locally`);
  } catch {
    console.log(`Image ${fullImage} not found locally, building...`);
  }

  // Build if missing
  if (!imageExists) {
    try {
      const result = await build(
        { ...options, pushToRegistry: false },
        context
      );

      if (!result.success) throw new Error("Build executor didn't succeed.");
    } catch (err) {
      throw new Error(`Failed to build image ${fullImage} before push: ${err}`);
    }
  }

  // Login
  if (!skipLogin) {
    try {
      console.log(`Logging into ${registry}`);
      // To avoid having the password in the shell history or logs, we use --password-stdin
      // Relevant docs: https://docs.docker.com/reference/cli/docker/login/#password-stdin
      await execAsync(
        `echo "${password}" | docker login ${registry} -u ${username} --password-stdin`
      );
    } catch (err) {
      throw new Error(`Docker login failed: ${err.message}`);
    }
  }

  // Push
  try {
    console.log(`Pushing image ${fullImage}`);
    await execAsync(`docker push ${fullImage}`);
  } catch (err) {
    throw new Error(`Docker push failed: ${err.message}`);
  }

  console.log(`Successfully pushed ${fullImage}`);

  return { success: true };
};

export default runExecutor;
