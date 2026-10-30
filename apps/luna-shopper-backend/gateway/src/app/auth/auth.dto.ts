import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GOOGLE_ID_TOKEN_MAX_LENGTH } from '@portfolio/luna-shopper/contracts';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AcceptedTermsVersion } from '../legal/accepted-terms-version.decorator';

/** Email + password registration (plan 0005, section 4.2). */
export class RegisterDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @AcceptedTermsVersion()
  acceptedTermsVersion?: string;
}

/** Email + password login (plan 0005, section 4.3). */
export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

/** Consume an email verification token (plan 0005, section 4.2). */
export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  token!: string;
}

/**
 * Ask for a password reset link (plan 0022, section 2). The address is all there
 * is: the caller has no session, which is the situation this endpoint exists for.
 */
export class ForgotPasswordDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;
}

/**
 * Spend a reset link (plan 0022, section 3). The password rules are the ones
 * registration enforces, stated here rather than shared, so a client reads the
 * same bounds in the same place for both.
 */
export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

/**
 * Sign in with a reset grant and keep the password (plan 0210, target state 5).
 *
 * `switchAccount` is read as it was spelled in the JSON, as the harvest
 * schedule reads its acknowledgement: the global pipe converts types, and a
 * string `"false"` would otherwise arrive as `true` and leave the session of
 * somebody who said no. Only a JSON `true` or `false` passes.
 */
export class RecoverySignInDto {
  @ApiProperty({ description: 'The raw token from either link of the mail.' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiPropertyOptional({
    description:
      'True when the caller is signed in as another account and agreed to leave it. Without it, that case answers 409 `recovery_other_account` and spends nothing.',
  })
  @Transform(
    ({ obj }: { obj: Record<string, unknown> }) => obj?.['switchAccount']
  )
  @IsOptional()
  @IsBoolean()
  switchAccount?: boolean;
}

/**
 * Trade the handoff code of a support session for its token pair (plan 0194).
 * The app reads the code from the fragment of the URL it was opened with.
 */
export class ExchangeImpersonationDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  code!: string;
}

/** Exchange a refresh token for a fresh pair (plan 0005, section 3). */
export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

/**
 * Upgrade the caller's temporary account in place (plan 0005, section 4.5). The
 * userId comes from the bearer token, not the body.
 */
export class UpgradeDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @AcceptedTermsVersion()
  acceptedTermsVersion?: string;
}

/**
 * base64url of 32 bytes or of a SHA-256: 43 characters with no padding (plan
 * 0230). The challenge and the verifier share the shape.
 */
const PKCE_VALUE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Start a Google sign in (plan 0230, section 2). The challenge is the one
 * thing the body requires. The link target is read from the verified bearer and
 * never from here.
 */
export class MintOAuthStateDto {
  @ApiProperty({
    description:
      'base64url of the SHA-256 of a verifier the client made and keeps, 43 characters. The verifier is sent only to `POST /v1/auth/google/exchange`.',
    pattern: PKCE_VALUE.source,
  })
  @IsString()
  @Matches(PKCE_VALUE)
  codeChallenge!: string;

  /**
   * Checked here, at the start, and recorded at the exchange (plan 0231,
   * section 4.2): a refusal at the start is a problem the app can show.
   */
  @AcceptedTermsVersion()
  acceptedTermsVersion?: string;
}

/**
 * Redeem the code the callback put in the fragment (plan 0230, section 4.3).
 * The verifier proves this is the browser that minted the state.
 */
export class ExchangeGoogleSignInDto {
  @ApiProperty({
    description: 'The single use code from the `#code=` fragment.',
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  code!: string;

  @ApiProperty({
    description:
      'The verifier whose SHA-256 was sent as `codeChallenge` at the mint: base64url of 32 random bytes, 43 characters.',
    pattern: PKCE_VALUE.source,
  })
  @IsString()
  @Matches(PKCE_VALUE)
  codeVerifier!: string;
}

/**
 * Mint the nonce of a Google sign in from the Android app (plan 0238, target
 * state 1). The caller is read from the verified bearer and never from here,
 * as on the state mint.
 *
 * `silent` is read as it was spelled in the JSON, as `switchAccount` is: the
 * global pipe converts types, and a string would otherwise arrive as a
 * boolean the app never sent. Only a JSON `true` or `false` passes.
 */
export class MintGoogleNonceDto {
  @ApiPropertyOptional({
    description:
      'True for a sign in nobody pressed for. It signs in only to an account this Google account already opens, and creates, links and accepts nothing. A silent nonce takes no `acceptedTermsVersion`.',
  })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj?.['silent'])
  @IsOptional()
  @IsBoolean()
  silent?: boolean;

  /**
   * Checked here, at the mint, and recorded at the sign in (plan 0231,
   * section 4.2). Auth refuses it on a silent nonce.
   */
  @AcceptedTermsVersion()
  acceptedTermsVersion?: string;
}

/**
 * Sign in with the Google ID token Credential Manager handed the app (plan
 * 0238, target state 2). The token carries the nonce of the mint; the caller
 * is read from the verified bearer.
 */
export class SignInWithGoogleIdTokenDto {
  @ApiProperty({
    description:
      'The Google ID token from Credential Manager, requested with the `clientId` and the `nonce` of `POST /v1/auth/google/nonce`.',
    maxLength: GOOGLE_ID_TOKEN_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(GOOGLE_ID_TOKEN_MAX_LENGTH)
  idToken!: string;
}
