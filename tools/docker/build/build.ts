import { PromiseExecutor } from '@nx/devkit';
import { exec } from 'child_process';
import * as path from 'path';
import { BuildExecutorSchema } from './schema';

const runExecutor: PromiseExecutor<BuildExecutorSchema> = async (
  options,
  context
) => {
  console.log('Executor ran for Build', options);

  const projectRoot =
    context.projectsConfigurations?.projects[context.projectName!].root;

  const registry = options.registry || process.env.DOCKER_REGISTRY;
  const tag = options.tag || process.env.DOCKER_TAG;

  const dockerfile = options.dockerfile
    ? path.join(projectRoot, options.dockerfile)
    : path.join(projectRoot, 'Dockerfile');

  const contextDir = options.context === 'project' ? projectRoot : context.root;

  const fullImage = `${registry ? `${registry}/` : ''}${options.imageName}:${tag}`;

  const noCacheFlag = options.noCache ? '--no-cache' : '';

  const buildCommand = `docker build ${noCacheFlag} -f ${dockerfile} -t ${fullImage} ${contextDir}`;

  console.log(`Running command: ${buildCommand}`);

  try {
    const result = await new Promise<string>((resolve, reject) => {
      exec(buildCommand, (error, stdout, stderr) => {
        if (error) {
          return reject(error);
        }

        if (stderr) {
          return reject(stderr);
        }

        resolve(stdout);
      });
    });

    console.log(`Docker build output for ${fullImage}: `, result);
    console.log(`Built image: ${fullImage}`);

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
