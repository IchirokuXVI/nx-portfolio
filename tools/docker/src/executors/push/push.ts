import { PromiseExecutor } from '@nx/devkit';
import { exec } from 'child_process';
import { promisify } from 'util';
import build from '../build/build';
import { resolveVersionTags } from '../version-tags';
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

  const { imageName } = options;
  const versionTags = resolveVersionTags(options.versionTags);
  const registry = options.registry || process.env.DOCKER_REGISTRY;

  const skipLogin =
    options.skipLogin || process.env.DOCKER_SKIP_LOGIN == 'true';

  const username = process.env.DOCKER_USERNAME;
  const password = process.env.DOCKER_PASSWORD;

  if (!registry || (!skipLogin && (!username || !password))) {
    throw new Error(
      `Missing required Docker configuration:
      DOCKER_REGISTRY=${registry || '(unset)'}
      DOCKER_USERNAME=${username ? '(set)' : skipLogin ? '(skipped)' : '(unset)'}
      DOCKER_PASSWORD=${password ? '(set)' : skipLogin ? '(skipped)' : '(unset)'}`
    );
  }

  const fullImages = versionTags.map(
    (tag) => `${registry}/${imageName}:${tag}`
  );

  // Build the image unless the caller already did. When the build executor invokes
  // push it passes skipBuild:true (the image was just built and loaded), so we don't
  // rebuild it here — that used to build every image a second time (once per tag).
  // A standalone `nx run <app>:push` leaves skipBuild falsy and still builds first.
  if (!options.skipBuild) {
    try {
      const result = await build({ ...options, pushToRegistry: false }, context);

      if (!result.success) throw new Error("Build executor didn't succeed.");
    } catch (err) {
      throw new Error(`Failed to build images before push: ${err}`);
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
    } catch (err: any) {
      throw new Error(`Docker login failed: ${err.message}`);
    }
  }

  // Push
  for (const tag of versionTags) {
    try {
      const fullImage = `${registry}/${imageName}:${tag}`.toLowerCase();
      console.log(`Pushing image ${fullImage}`);
      await execAsync(`docker push ${fullImage}`);

      console.log(`Successfully pushed ${fullImage}`);
    } catch (err: any) {
      throw new Error(`Docker push failed: ${err.message}`);
    }
  }

  return { success: true };
};

export default runExecutor;
