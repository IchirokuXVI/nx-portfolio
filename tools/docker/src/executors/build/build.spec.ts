import { ExecutorContext } from '@nx/devkit';

import path from 'path';
import executor from './build';
import { BuildExecutorSchema } from './schema';
import { simpleHash } from './simple-hash';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  // exec is unused by the build executor (it streams via spawn) but the push
  // executor it imports promisifies exec at module load, so it must be a function.
  exec: jest.fn(),
}));

jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp'),
}));

const { spawn: mockedSpawn } = jest.requireMock('child_process');

// A fake ChildProcess that fires `close` with the given exit code on the next
// tick, mirroring how the executor's streaming runner listens for it.
function mockSpawnExit(code: number) {
  return () => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const child = {
      on: (event: string, cb: (arg?: unknown) => void) => {
        handlers[event] = cb;
        return child;
      },
    };
    setImmediate(() => handlers['close']?.(code));
    return child;
  };
}

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
  `--build-arg testArg="testValue" --build-arg NX_APP="my-test-project" --build-arg TARGET_REGISTRY="my-test-registry/" ` +
  `--cache-from=type=local,src="${path.join(`/tmp/docker-cache/.buildx-${simpleHash(options.imageName)}`)}" --cache-to=type=local,dest="${path.join(`/tmp/docker-cache-new/.buildx-${simpleHash(options.imageName)}`)}",mode=max ` +
  `${path.join('apps/my-test-project')} ` +
  `--load`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Build Executor', () => {
  it('can run', async () => {
    mockedSpawn.mockImplementation(mockSpawnExit(0));

    const output = await executor(options, context);

    expect(output.success).toBe(true);

    expect(mockedSpawn).toHaveBeenCalledWith(expectedBuildCommand, {
      shell: true,
      stdio: 'inherit',
    });
  });

  it('handles build errors', async () => {
    mockedSpawn.mockImplementation(mockSpawnExit(1));

    await expect(executor(options, context)).rejects.toThrow(
      'Error during Docker build: exited with code 1'
    );

    expect(mockedSpawn).toHaveBeenCalledWith(expectedBuildCommand, {
      shell: true,
      stdio: 'inherit',
    });
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
