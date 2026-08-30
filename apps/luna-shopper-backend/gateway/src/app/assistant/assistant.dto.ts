import { ApiProperty } from '@nestjs/swagger';
import { AssistantRole } from '@portfolio/luna-shopper/contracts';
import { plainToInstance, Transform, Type } from 'class-transformer';
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

/**
 * A spoken turn (plan 0041, section 4.1).
 *
 * `multipart/form-data`, so the recording travels as a file part and everything
 * else as a form field. Base64 in a JSON body would inflate the upload by a third
 * on the one leg that actually costs the person something, which is a phone on
 * mobile data.
 *
 * There is no `message` here, and that absence is the whole shape of the thing:
 * what the caller said is inside the recording, and nobody knows it until the
 * service has transcribed it.
 */
export class AssistantVoiceDto {
  /**
   * The conversation so far, as a JSON string.
   *
   * A multipart body has no shape for a nested array, so it arrives as one field
   * holding JSON and is parsed here. The **same rules** as the typed route apply
   * to it afterwards, from the same class, because two routes that disagreed
   * about what a transcript is would be a bug waiting for whichever one was
   * edited second.
   *
   * Malformed JSON is deliberately left as the string it arrived as rather than
   * raised here: `@IsArray` then refuses it and the caller gets the house
   * `validation_failed` envelope like every other bad body, instead of a parse
   * error escaping as a 500.
   */
  @ApiProperty({
    type: 'string',
    description:
      'The conversation so far, oldest first, as a JSON array of {role, content}.',
    example: '[{"role":"USER","content":"add milk to the weekly shop"}]',
  })
  @Transform(({ value }) => parseTranscript(value))
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  transcript!: AssistantMessageDto[];
}

/**
 * The transcript field, as the array the DTO above validates.
 *
 * `plainToInstance` rather than the parsed objects as they are, because
 * `@ValidateNested` looks the nested rules up from the **instance's**
 * constructor: a bag of plain objects has no metadata, so every entry would pass
 * every check by having none, and the spoken route would accept a transcript the
 * typed route refuses.
 */
function parseTranscript(value: unknown): unknown {
  if (Array.isArray(value)) {
    return plainToInstance(AssistantMessageDto, value);
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? plainToInstance(AssistantMessageDto, parsed)
      : parsed;
  } catch {
    return value;
  }
}
