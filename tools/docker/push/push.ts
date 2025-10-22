import {
  PromiseExecutor,
  readTargetOptions,
  runExecutor as runOtherExecutor,
} from '@nx/devkit';
import { execSync } from 'child_process';
import { PushExecutorSchema } from './schema';

const runExecutor: PromiseExecutor<PushExecutorSchema> = async (
  options,
  context
) => {
  console.log('Executor ran for Push', options);

  const { registry, imageName, tag } = await readTargetOptions(
    {
      project: context.projectName!,
      target: 'build',
      configuration: context.configurationName,
    },
    context
  );

  const fullImage = `${registry}/${imageName}:${tag}`;

  const username = process.env.PORTFOLIO_DOCKER_USERNAME;
  const password = process.env.PORTFOLIO_DOCKER_PASSWORD;

  if (!registry || !username || !password) {
    throw new Error(
      `Missing required Docker configuration:
      DOCKER_REGISTRY=${registry || '(unset)'}
      DOCKER_USERNAME=${username ? '(set)' : '(unset)'}
      DOCKER_PASSWORD=${password ? '(set)' : '(unset)'}`
    );
  }

  try {
    console.log(`📦 Checking for local image: ${fullImage}`);

    // Check if image exists locally
    let imageExists = false;
    try {
      execSync(`docker image inspect ${fullImage}`, { stdio: 'ignore' });
      imageExists = true;
      console.log(`Image ${fullImage} already built locally`);
    } catch {
      console.log(`Image ${fullImage} not found locally, building...`);
    }

    // Build if missing
    if (!imageExists) {
      for await (const result of await runOtherExecutor(
        {
          project: context.projectName!,
          target: 'build',
          configuration: context.configurationName,
        },
        {},
        context
      )) {
        if (!result.success) throw new Error('Build failed before push.');
      }
    }

    // Login
    const skipLogin =
      options.skipLogin || process.env.PORTFOLIO_DOCKER_SKIP_LOGIN === 'true';
    if (!skipLogin) {
      console.log(`🔑 Logging into ${registry}`);
      // To avoid having the password in the shell history or logs, we use --password-stdin
      // Relevant docs: https://docs.docker.com/reference/cli/docker/login/#password-stdin
      execSync(
        `echo "${password}" | docker login ${registry} -u ${username} --password-stdin`,
        { stdio: 'inherit' }
      );
    }

    // Push
    console.log(`🚀 Pushing image ${fullImage}`);
    execSync(`docker push ${fullImage}`, { stdio: 'inherit' });
    console.log(`✅ Successfully pushed ${fullImage}`);

    return { success: true };
  } catch (err) {
    console.error(`Docker push for ${fullImage} failed:`, err);

    return { success: false };
  }
};

export default runExecutor;
