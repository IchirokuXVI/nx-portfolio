import { Credential } from './credential.entity';
import { EmailVerification } from './email-verification.entity';
import { OAuthIdentity } from './oauth-identity.entity';
import { RefreshToken } from './refresh-token.entity';
import { User } from './user.entity';

export { BaseEntity } from './base.entity';
export { Credential } from './credential.entity';
export { EmailVerification } from './email-verification.entity';
export { OAuthIdentity } from './oauth-identity.entity';
export { RefreshToken } from './refresh-token.entity';
export { User } from './user.entity';

/** Every auth entity, for TypeOrmModule registration and the CLI data source. */
export const AUTH_ENTITIES = [
  User,
  Credential,
  OAuthIdentity,
  EmailVerification,
  RefreshToken,
];
