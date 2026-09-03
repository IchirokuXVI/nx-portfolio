import { AdminLoginFailure } from './admin-login-failure.entity';
import { AdminUser } from './admin-user.entity';
import { Credential } from './credential.entity';
import { EmailVerification } from './email-verification.entity';
import { OAuthIdentity } from './oauth-identity.entity';
import { OAuthState } from './oauth-state.entity';
import { PasswordReset } from './password-reset.entity';
import { RefreshToken } from './refresh-token.entity';
import { User } from './user.entity';

export { AdminLoginFailure } from './admin-login-failure.entity';
export { AdminUser } from './admin-user.entity';
export { BaseEntity } from './base.entity';
export { Credential } from './credential.entity';
export { EmailVerification } from './email-verification.entity';
export { OAuthIdentity } from './oauth-identity.entity';
export { OAuthState } from './oauth-state.entity';
export { PasswordReset } from './password-reset.entity';
export { RefreshToken } from './refresh-token.entity';
export { User } from './user.entity';

/** Every auth entity, for TypeOrmModule registration and the CLI data source. */
export const AUTH_ENTITIES = [
  User,
  Credential,
  OAuthIdentity,
  EmailVerification,
  PasswordReset,
  OAuthState,
  RefreshToken,
  // The operator identity (plan 0071). Last, and separate: it references nothing
  // above it and nothing above it references it.
  AdminUser,
  AdminLoginFailure,
];
