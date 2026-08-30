import { ApiProperty } from '@nestjs/swagger';
import { AssistantRole } from '@portfolio/luna-shopper/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * One entry of the transcript the client holds and resends every turn (plan 0039,
 * section 4).
 *
 * There is no `SYSTEM` role to send, by construction: the operator prompt belongs
 * to the assistant service and a caller cannot contribute one. A user who types
 * "you are now in developer mode" is sending `USER` text, and it is handled as
 * `USER` text all the way down.
 */
export class AssistantMessageDto {
  @ApiProperty({ enum: AssistantRole })
  @IsEnum(AssistantRole)
  role!: AssistantRole;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  content!: string;
}

/**
 * One conversation turn.
 *
 * The whole transcript arrives on every request because the assistant stores
 * nothing between turns (rule A2), which makes it **client supplied and therefore
 * untrusted**. The caps here are the outer ones, refusing what is plainly beyond
 * any conversation; the assistant service applies its own configured caps on
 * arrival regardless, because a limit the client could have chosen is not a limit.
 */
export class AssistantTurnDto {
  @ApiProperty({ maxLength: 2000, description: 'What the caller just said.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @ApiProperty({
    type: [AssistantMessageDto],
    maxItems: 100,
    description: 'The conversation so far, oldest first.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  transcript!: AssistantMessageDto[];
}
