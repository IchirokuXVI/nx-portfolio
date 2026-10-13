import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IMPERSONATION_NOTE_MAX,
  ImpersonationReason,
} from '@portfolio/luna-shopper/contracts';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Why an operator opens the app as a user, and in which language (plan 0194).
 *
 * The pairing of `note` with `reason` is checked in auth, where the rule lives:
 * `OTHER` needs a note of 1 to 500 characters, and every other reason refuses
 * one. Here the note is only bounded.
 */
export class StartImpersonationDto {
  @ApiProperty({ enum: ImpersonationReason })
  @IsEnum(ImpersonationReason)
  reason!: ImpersonationReason;

  @ApiPropertyOptional({
    maxLength: IMPERSONATION_NOTE_MAX,
    description:
      'Required for the reason `OTHER`, and refused for every other reason.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(IMPERSONATION_NOTE_MAX)
  note?: string;

  @ApiPropertyOptional({
    description:
      'The locale of the page the URL opens; defaults to the request locale.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale?: string;
}
