import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { GatewayConfig } from '../config/app-config';
import {
  ApiProblemResponses,
  componentRef,
  hoistAdminEnvironment,
} from '../docs';

/** Hoisted at module load, so the component exists before the document is built. */
const ADMIN_ENVIRONMENT_SCHEMA = hoistAdminEnvironment();

/** Which deployment answered, for a caller with no token. */
export interface AdminEnvironmentResponse {
  environment: string;
}

/**
 * The same environment name `GET /v1/admin/auth/me` carries, for a caller that has
 * no token yet (`apps/luna-shopper-admin/plans/0001`, section 6).
 *
 * **Unauthenticated, and that is the entire reason it exists.** The back office
 * renders a different accent colour per environment so an operator cannot mistake
 * which database they are about to write to, and it has to draw that colour before
 * anybody has signed in: on the placeholder page that plan 0001 ships, and from
 * plan `0002` onward on the login screen itself. `me` is the authenticated half and
 * stays the source once there is a session; this is the half that answers first.
 *
 * Section 6 of that plan sanctions exactly this route, in those words, as the
 * alternative to an unauthenticated field on `me` — and `me` has no unauthenticated
 * part, so this is what is left.
 *
 * It answers from the pod's own configuration, which is the whole feature: the
 * failure being guarded against is believing you are in staging when you are in
 * production, and a build time constant is exactly what is wrong in that scenario,
 * whether from a stale cache, a mis tagged image, or a bundle served from the wrong
 * host. It reads the same `environmentName` that `me` does, so the two cannot
 * disagree about one deployment.
 *
 * Nothing here is a secret. Which environment answered is already legible from the
 * hostname the request arrived on; what this buys is that the client no longer has
 * to infer it from one.
 */
@ApiTags('admin')
@Controller({ path: 'admin/environment', version: '1' })
export class AdminEnvironmentController {
  private readonly config: GatewayConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<GatewayConfig>('gateway');
  }

  @Get()
  @ApiOkResponse({
    description:
      'Which deployment answered. The back office derives its accent colour and its document title from this, and never from a build time constant.',
    schema: componentRef(ADMIN_ENVIRONMENT_SCHEMA),
  })
  @ApiProblemResponses()
  read(): AdminEnvironmentResponse {
    return { environment: this.config.environmentName };
  }
}
