import type { ConfigService } from '@nestjs/config';
import { AdminEnvironmentController } from './admin-environment.controller';

/**
 * The unauthenticated environment read the back office draws its accent colour
 * from (`apps/luna-shopper-admin/plans/0001`, section 6).
 *
 * What is worth guarding is that the answer comes from the pod's own configuration
 * and is never invented: the point of the feature is that an operator cannot be
 * told they are in staging while writing to production, so a value the client could
 * have supplied, or the server could have guessed, would reintroduce exactly that.
 */
function configWith(environmentName: string): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key !== 'gateway') {
        throw new Error(`unexpected config namespace ${key}`);
      }
      return { environmentName };
    },
  } as unknown as ConfigService;
}

describe('GET /v1/admin/environment', () => {
  it.each(['production', 'staging', 'development'])(
    'reports the deployment it is configured as: %s',
    (environmentName) => {
      const controller = new AdminEnvironmentController(
        configWith(environmentName)
      );

      expect(controller.read()).toEqual({ environment: environmentName });
    }
  );

  /**
   * `ENVIRONMENT_NAME` is a free string, so a deployment can report a name nobody
   * has thought of. This route passes it through rather than normalising or
   * rejecting it: the back office is the one that decides what it can colour, and
   * it renders an unrecognised name as "unknown" instead of picking a colour. A
   * gateway that silently rewrote an unexpected value to one of the three would be
   * manufacturing the confident wrong answer this whole feature exists to prevent.
   */
  it('passes an unexpected environment name through rather than normalising it', () => {
    const controller = new AdminEnvironmentController(configWith('preview-7'));

    expect(controller.read()).toEqual({ environment: 'preview-7' });
  });

  /**
   * It reads the same `environmentName` that `GET /v1/admin/auth/me` does, so the
   * authenticated and unauthenticated halves cannot disagree about one deployment.
   * That is the reason this route reads config rather than holding a value of its
   * own.
   */
  it('reads the one config value, and no other namespace', () => {
    const seen: string[] = [];
    const config = {
      getOrThrow: (key: string) => {
        seen.push(key);
        return { environmentName: 'staging' };
      },
    } as unknown as ConfigService;

    new AdminEnvironmentController(config).read();

    expect(seen).toEqual(['gateway']);
  });
});
