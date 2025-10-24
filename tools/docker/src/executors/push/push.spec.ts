import { ExecutorContext } from '@nx/devkit';

import executor from './push';
import { PushExecutorSchema } from './schema';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('../build/build', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedExec = jest.requireMock('child_process').exec;
const { default: mockedBuildExecutor } = jest.requireMock('../build/build');

const options: PushExecutorSchema = {
  registry: 'my-test-registry',
  imageName: 'my-test-image',
  dockerfile: 'Dockerfile',
  context: 'dockerfile',
  versionTag: 'latest',
  buildArgs: {
    testArg: 'testValue',
  },
  addNodeEnv: true,
  noCache: false,
  skipLogin: false,
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
        tags: ['type:docker'],
      },
    },
    version: 2,
  },
  nxJsonConfiguration: {},
};

beforeEach(() => {
  jest.clearAllMocks();

  process.env.PORTFOLIO_DOCKER_USERNAME = 'testuser';
  process.env.PORTFOLIO_DOCKER_PASSWORD = 'testpass';
});

afterEach(() => {
  delete process.env.PORTFOLIO_DOCKER_USERNAME;
  delete process.env.PORTFOLIO_DOCKER_PASSWORD;
});

describe('Push Executor', () => {
  it('can run', async () => {
    mockedExec.mockImplementation(
      (
        command: any,
        callback: (error: any, stdout: any, stderr: any) => void
      ) => {
        callback(null, 'stdout', null);
      }
    );

    mockedBuildExecutor.mockImplementation(async () => ({ success: true }));

    const output = await executor(options, context);

    expect(output.success).toBe(true);

    expect(mockedExec).toHaveBeenCalledTimes(3);

    expect(mockedExec).toHaveBeenCalledWith(
      `docker image inspect my-test-registry/my-test-image:latest`,
      expect.any(Function)
    );

    expect(mockedExec).toHaveBeenCalledWith(
      `echo \"testpass\" | docker login my-test-registry -u testuser --password-stdin`,
      expect.any(Function)
    );

    expect(mockedExec).toHaveBeenCalledWith(
      `docker push my-test-registry/my-test-image:latest`,
      expect.any(Function)
    );
  });

  it('throws error if required env vars are missing', async () => {
    delete process.env.PORTFOLIO_DOCKER_USERNAME;
    delete process.env.PORTFOLIO_DOCKER_PASSWORD;

    await expect(executor(options, context)).rejects.toThrow();

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('throws error if registry is missing', async () => {
    await expect(
      executor({ ...options, registry: undefined }, context)
    ).rejects.toThrow();

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('builds the image if not found locally', async () => {
    mockedExec.mockImplementation(
      (
        command: any,
        callback: (error: any, stdout: any, stderr: any) => void
      ) => {
        if (command.startsWith('docker image inspect')) {
          // Simulate image not found
          callback(new Error('not found'), null, null);
        } else {
          callback(null, 'stdout', null);
        }
      }
    );

    mockedBuildExecutor.mockImplementation(async () => ({ success: true }));

    const output = await executor(options, context);

    expect(output.success).toBe(true);

    expect(mockedBuildExecutor).toHaveBeenCalledWith(
      { ...options, pushToRegistry: false },
      context
    );
  });

  it('skips login if set in env', async () => {
    process.env.PORTFOLIO_DOCKER_SKIP_LOGIN = 'true';

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

    expect(mockedExec).not.toHaveBeenCalledWith(
      expect.stringContaining('docker login'),
      expect.any(Function)
    );
  });

  it('handles missing project name', async () => {
    const invalidContext = { ...context, projectName: undefined };

    await expect(executor(options, invalidContext)).rejects.toThrow(
      'Docker push executor requires a project name. ' +
        'Make sure you run it as part of an Nx project target (e.g. nx run myapp:push).'
    );
  });

  it('handles project not found', async () => {
    const invalidContext = { ...context, projectName: 'non-existent-project' };

    await expect(executor(options, invalidContext)).rejects.toThrow(
      `Project ${invalidContext.projectName} not found.`
    );
  });
});
