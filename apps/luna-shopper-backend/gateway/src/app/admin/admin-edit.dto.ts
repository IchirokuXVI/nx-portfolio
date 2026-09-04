import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LINE_ITEM_SET_CEILING,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LineApprovalStatus,
  UsernamePropagation,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * The bodies of every write plan 0077 adds to the back office.
 *
 * Their own file rather than more classes on `admin-directory.dto.ts`, which
 * holds the filters of plan 0074's listings. A reader who wants to know what an
 * operator can change opens this file and sees the whole answer, and, just as
 * usefully, sees what is missing from it.
 *
 * **What is missing is the point.** A user's `email`, `emailVerifiedAt` and
 * `kind` are columns an operator can see and cannot change; a zone's `joinCode`,
 * `ownerUserId`, `status` and `markedForDeletionAt` are the same; a membership's
 * `status` is the same. Each is excluded for a reason plan 0077 section 6 gives
 * in full, and `admin-edit-fields.spec.ts` asserts that no DTO here carries one.
 * Adding a field to one of these classes is therefore a deliberate act with a
 * failing test in front of it, which is what the plan wanted.
 */

/**
 * A user's username and display name (plan 0077, section 3).
 *
 * The two are not the same kind of write, and the controller treats them
 * differently for a reason the DTO cannot express: the username goes through
 * `IdentityService`, because core rewrites the per zone name from the event it
 * emits, and the display name is a direct column write, because nothing derives
 * from it.
 */
export class UpdateAdminUserDto {
  @ApiPropertyOptional({
    maxLength: 40,
    description:
      'The global username. It reaches every one of this person’s memberships through the propagation below, because a direct column write would leave the global name and every per zone name disagreeing forever.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  username?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 200,
    description:
      'Whatever an identity provider supplied, which for a Google sign in is somebody’s real full name. Absent leaves it alone; null clears it. It stays off every listing and appears only on the detail screen (plan 0074, section 4).',
  })
  @IsOptional()
  // Null is a value here rather than an omission, so the string validators have
  // to stand aside for it. `@IsOptional` alone would let null through every
  // check, including on the fields where null is meaningless.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @ApiPropertyOptional({
    enum: UsernamePropagation,
    description:
      'How far the rename reaches. Defaulted exactly as the user facing path defaults it: an operator renaming somebody is doing what that person could do to themselves, so it behaves the same.',
  })
  @IsOptional()
  @IsEnum(UsernamePropagation)
  usernamePropagation?: UsernamePropagation;
}

/**
 * A zone's name and config (plan 0077, section 4.1).
 *
 * The whole of what a zone's own owner may change, and an operator gets exactly
 * the same two.
 */
export class UpdateAdminZoneDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'The zone’s own settings blob, replaced whole rather than merged, which is what `zone.update` does for its owner.',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/**
 * A membership's role and its per zone name (plan 0077, section 4.3).
 *
 * `status` is deliberately absent. It moves along a state machine with a service
 * method per edge, and each edge does more than write the enum: approving emits
 * `MemberApproved` and writes `approvedByUserId`, banning keeps the row so the
 * ban survives, rejecting removes a pending row. A body carrying `status` would
 * have to dispatch to four methods by inspecting the value, which is a switch
 * statement whose branches drift. The four verbs are four routes instead.
 *
 * `role` keeps both refusals `setRole` carries: assigning `OWNER` is refused,
 * because ownership is a transfer and the transfer is a transaction, and demoting
 * the current owner is refused for the same reason.
 */
export class UpdateAdminMembershipDto {
  @ApiPropertyOptional({
    enum: ZoneRole,
    description:
      'OWNER is refused here. Handing the zone to somebody is `POST members/:membershipId/ownership`, which is two role changes and a column in one transaction.',
  })
  @IsOptional()
  @IsEnum(ZoneRole)
  role?: ZoneRole;

  @ApiPropertyOptional({
    maxLength: 40,
    description:
      'The per zone name, which is the only personal field a membership holds. Nothing changes globally: `users.username` is untouched.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  username?: string;
}

/**
 * A list's name and its two flags (plan 0077, section 5.1), which is everything
 * `UpdateListRequest` carries.
 */
export class UpdateAdminListDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Whether a new line on this list is approved the moment it is added. It governs only what a **new** line starts as.',
  })
  @IsOptional()
  @IsBoolean()
  autoApproveLines?: boolean;

  @ApiPropertyOptional({
    description:
      'Open the list to its zone. **Asymmetric, and the screen has to say so:** turning it on grants READ, WRITE and DECIDE to every currently approved non staff member, and turning it off revokes nobody. It governs who arrives next. An operator who toggles it off expecting the list to close has not closed it.',
  })
  @IsOptional()
  @IsBoolean()
  sharedWithZone?: boolean;
}

/**
 * A line's content, quantity and product set (plan 0077, section 5.2).
 *
 * **The operator edits with `MANAGE`**, which core resolves for itself, so this
 * reaches every field a member holding `MANAGE` reaches and an approved line
 * stays approved. A `REJECTED` line still reopens, because that rule applies to
 * everyone.
 *
 * No `adoptItemIds`, unlike the member facing body. Adoption moves a product from
 * the line's group to the **person** holding the line, and an operator is not
 * that person; performing it on somebody's behalf would record a choice they did
 * not make.
 *
 * No `position`, because reordering is a whole order rather than a field and has
 * no meaning outside the screen a member drags rows on.
 */
export class UpdateAdminLineDto {
  @ApiPropertyOptional({ maxLength: 400 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  content?: string;

  @ApiPropertyOptional({
    minimum: LINE_QUANTITY_MIN,
    maximum: LINE_QUANTITY_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(LINE_QUANTITY_MIN)
  @Max(LINE_QUANTITY_MAX)
  quantity?: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: LINE_ITEM_SET_CEILING,
    description:
      'Replace the line’s product set; an empty array clears it back to free text. The real bound is max(100, what the line currently holds) and is applied in core, which is the only layer that can see the second half of it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINE_ITEM_SET_CEILING)
  @IsUUID(undefined, { each: true })
  itemIds?: string[];
}

/** Approve or reject one line (plan 0077, section 5.2). */
export class SetAdminLineApprovalDto {
  @ApiProperty({ enum: LineApprovalStatus })
  @IsEnum(LineApprovalStatus)
  status!: LineApprovalStatus;
}
