import { ExecutorContext } from '@nx/devkit';

import path from 'path';
import executor from './build';
import { BuildExecutorSchema } from './schema';
import { simpleHash } from './simple-hash';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp'),
}));

const { exec: mockedExec } = jest.requireMock('child_process');

const options: BuildExecutorSchema = {
  imageName: 'my-test-image',
  dockerfile: 'Dockerfile',
  context: 'dockerfile',
  registry: 'my-test-registry',
  versionTags: ['latest', '0.0.1'],
  buildArgs: {
    testArg: 'testValue',
  },
  noCache: false,
  pushToRegistry: false,
};

const context: ExecutorContext = {
  root: '',
  projectName: 'my-test-project',
  cwd: process.cwd(),
  isVerbose: false,
  projectGraph: {
    nodes: {},
    dependencies: {},
  },
  projectsConfigurations: {
    projects: {
      'my-test-project': {
        root: 'apps/my-test-project',
        sourceRoot: 'apps/my-test-project/src',
        projectType: 'application',
        tags: ['type:static-docker'],
      },
    },
    version: 2,
  },
  nxJsonConfiguration: {},
};

const expectedBuildCommand =
  `docker buildx build ` +
  `-f ${path.join('apps/my-test-project/Dockerfile')} ` +
  `-t my-test-registry/my-test-image:latest -t my-test-registry/my-test-image:0.0.1 ` +
  `--build-arg testArg=testValue --build-arg NODE_ENV=test --build-arg NX_APP=my-test-project --build-arg TARGET_REGISTRY=my-test-registry/ ` +
  `--cache-from=type=local,src="${path.join(`/tmp/docker-cache/.buildx-${simpleHash(options.imageName)}`)}" --cache-to=type=local,dest="${path.join(`/tmp/docker-cache-new/.buildx-${simpleHash(options.imageName)}`)}",mode=max ` +
  `${path.join('apps/my-test-project')} ` +
  `--load`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Build Executor', () => {
  it('can run', async () => {
    mockedExec.mockImplementation(
      (
        command: any,
        callback: (error: any, stdout: any, stderr: any) => void
      ) => {
        callback(null, 'stdout', null);
      }
    );

    const output = await executor(options, context);

    expect(output.success).toBe(true);

    expect(mockedExec).toHaveBeenCalledWith(
      expectedBuildCommand,
      expect.any(Function)
    );
  });

  it('handles exec errors', async () => {
    (mockedExec as jest.Mock).mockImplementation((command, callback) => {
      callback(new Error('exec error'), null, null);
    });

    await expect(executor(options, context)).rejects.toThrow(
      'Error during Docker build: exec error'
    );

    expect(mockedExec).toHaveBeenCalledWith(
      expectedBuildCommand,
      expect.any(Function)
    );
  });

  it('handles missing project name', async () => {
    const invalidContext = { ...context, projectName: undefined };

    await expect(executor(options, invalidContext)).rejects.toThrow(
      'Docker build executor requires a project name. ' +
        'Make sure you run it as part of an Nx project target (e.g. nx run myapp:build).'
    );
  });

  it('handles project not found', async () => {
    const invalidContext = { ...context, projectName: 'non-existent-project' };

    await expect(executor(options, invalidContext)).rejects.toThrow(
      `Project ${invalidContext.projectName} not found.`
    );
  });
});
