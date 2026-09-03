import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid operator token (plan 0071, section 5).
 *
 * It names the `admin-jwt` strategy, and `JwtAuthGuard` names `jwt`, so the two
 * principals cannot be substituted for one another: a velista access token
 * presented here fails to verify against the admin public key, and an admin token
 * presented to any route guarded by `JwtAuthGuard` fails to verify against
 * auth's. Both directions are asserted in `admin-token-separation.spec.ts`,
 * because the property that falls out of the key split today is the property a
 * future key consolidation would remove silently.
 */
@Injectable()
export class AdminJwtGuard extends AuthGuard('admin-jwt') {}
