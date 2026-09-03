import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Operator sign in (plan 0071, section 5).
 *
 * By username, not by email: an admin row has no email column, no verification
 * and no reset token, because every recovery channel is also an attack channel
 * and this table has one user.
 *
 * The caps are there so a hostile body cannot make the gateway hash a megabyte;
 * the minimum length that matters is enforced where the password is *set*, by the
 * create command in section 6, rather than here, where a rule about how good a
 * password must be would only tell an attacker which guesses not to bother with.
 */
export class AdminLoginDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  password!: string;
}
