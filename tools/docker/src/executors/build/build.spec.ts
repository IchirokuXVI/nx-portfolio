import { ExecutorContext } from '@nx/devkit';

import path from 'path';
import executor from './build';
import { BuildExecutorSchema } from './schema';
import { simpleHash } from './simple-hash';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  // exec is unused by the build executor, which streams via spawn, but jest needs
  // every named export the module surface promises to be present.
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

  // `--push` streams layers to the registry from the build. `--load` would instead
  // export a tarball into the local daemon for `docker push` to read straight back
  // out, which is a round trip nothing in CI reads.
  it('pushes from the build instead of loading when pushToRegistry is set', async () => {
    mockedSpawn.mockImplementation(mockSpawnExit(0));

    const output = await executor(
      { ...options, pushToRegistry: true },
      context
    );

    expect(output.success).toBe(true);

    const [command] = mockedSpawn.mock.calls[0];
    expect(command).toContain('--push');
    expect(command).not.toContain('--load');
    // Both tags go up in the one build, rather than one push per tag.
    expect(command).toContain('-t my-test-registry/my-test-image:latest');
    expect(command).toContain('-t my-test-registry/my-test-image:0.0.1');
    // The separate push executor is not invoked, so `docker push` never runs.
    expect(jest.requireMock('child_process').exec).not.toHaveBeenCalled();
  });

  // An image that only copies a finished bundle wants the bundle as its context,
  // not the workspace. The path is derived from the project name, so nothing has to
  // repeat where the output lands.
  it('uses the project build output as the context when context is dist', async () => {
    mockedSpawn.mockImplementation(mockSpawnExit(0));

    await executor({ ...options, context: 'dist' }, context);

    const [command] = mockedSpawn.mock.calls[0];
    expect(command).toContain(` ${path.join('dist/apps/my-test-project')} `);
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
