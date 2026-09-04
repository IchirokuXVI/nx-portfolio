import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AdminEnvironmentController } from './admin-environment.controller';

/**
 * The environment route over real HTTP, because the thing that has to be true
 * about it is not what the handler returns but that it can be reached **with no
 * credentials at all** (`apps/luna-shopper-admin/plans/0001`, section 6).
 *
 * The unit spec beside this one calls the handler directly, and a handler called
 * directly cannot tell you whether a guard would have refused the request before
 * it ran. That is the whole risk here: every other route under `/v1/admin` is
 * guarded, this one deliberately is not, and the failure mode of getting it wrong
 * is a back office that cannot draw its colour until somebody signs in, which is
 * exactly when it is most needed.
 *
 * A stubbed config, so nothing here needs the compose stack.
 */

async function boot(environmentName: string) {
  const nest = (
    await Test.createTestingModule({
      controllers: [AdminEnvironmentController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => ({
              environmentName,
              admin: { devAutologin: false },
            }),
          },
        },
      ],
    }).compile()
  ).createNestApplication();

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, origin: `http://127.0.0.1:${port}` };
}

describe('GET /admin/environment over HTTP', () => {
  it('answers a request carrying no Authorization header', async () => {
    const { nest, origin } = await boot('staging');
    try {
      const res = await fetch(`${origin}/admin/environment`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        environment: 'staging',
        devAutologin: false,
      });
    } finally {
      await nest.close();
    }
  });

  /**
   * A bearer token that means nothing must not turn a 200 into a 401. Nothing on
   * this route inspects credentials, and the back office will start sending one
   * once `0002` holds a session, so a route that began refusing malformed tokens
   * would break the colour precisely when a session had gone stale.
   */
  it('ignores an Authorization header rather than trying to verify it', async () => {
    const { nest, origin } = await boot('production');
    try {
      const res = await fetch(`${origin}/admin/environment`, {
        headers: { Authorization: 'Bearer not-a-real-token' },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        environment: 'production',
        devAutologin: false,
      });
    } finally {
      await nest.close();
    }
  });
});
