import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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
}
