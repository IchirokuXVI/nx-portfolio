import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  PROFILE_PATTERNS,
  type DeleteAccountResult,
  type ShoppingProfileListResult,
  type ShoppingProfileView,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { asRejectedCredentials } from '../auth/remote-problem';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { UpdateProfileDto } from './account.dto';
import {
  AddPostalCodeDto,
  CreateShoppingProfileDto,
  SetProfileLocationsDto,
  UpdateShoppingProfileDto,
} from './shopping-profile.dto';

/**
 * The caller's own account: the profile routes (plan 0018, section 12) and
 * deletion (plan 0011).
 *
 * Every route takes its `userId` from the verified token, never from the body or
 * a path parameter, so a caller can only ever read or change themselves. Deletion
 * works for temporary and registered users alike (both hold a token): auth then
 * emits `user.deleted` and core reacts by retiring memberships and marking owned
 * zones for deletion.
 *
 * Because every route here is keyed on that `userId` and on nothing else, an
 * `auth` answer of "not found" can only ever mean one thing: the account the
 * token names is gone. That is a statement about the credential rather than
 * about a resource, so it leaves as a 401 (see {@link asRejectedCredentials}) —
 * which is what lets a client holding a pair from before a deletion, or from
 * before the database was reset, drop it instead of retrying it forever.
 */
@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'account', version: '1' })
export class AccountController {
  constructor(
    private readonly nats: NatsClient,
    // Every profile edit passes through here, so this is where the gateway's
    // resolved scope cache is dropped (plan 0049, section 2.1): the same instant
    // core emits `profiles.changed` for the user's other devices.
    private readonly scopes: ScopeResolutionService
  ) {}

  /** Every call this controller makes, under the rule in the class comment. */
  private aboutTheCaller<T>(subject: string, payload: object): Promise<T> {
    return this.nats.send<T>(subject, payload).catch((error: unknown) => {
      throw asRejectedCredentials(error);
    });
  }

  /** The caller's own profile, which is where the app bar gets a name to show. */
  @Get('me')
  @ApiContractResponse(AUTH_PATTERNS.getProfile)
  @ApiProblemResponses({ auth: true })
  me(@AuthUser() user: CurrentUser): Promise<UserProfileView> {
    return this.aboutTheCaller<UserProfileView>(AUTH_PATTERNS.getProfile, {
      userId: user.userId,
    });
  }

  /**
   * Change the global username, and optionally the per zone copies of it.
   * Throttled: a public, non unique, freely changeable name makes rapid renaming
   * a plausible harassment pattern (plan 0018, section 6).
   */
  @Patch('me')
  @Throttle(THROTTLE_LIMITS.usernameChange)
  @ApiContractResponse(AUTH_PATTERNS.setUsername)
  @ApiProblemResponses({ auth: true, body: true })
  updateMe(
    @AuthUser() user: CurrentUser,
    @Body() dto: UpdateProfileDto
  ): Promise<UserProfileView> {
    return this.aboutTheCaller<UserProfileView>(AUTH_PATTERNS.setUsername, {
      userId: user.userId,
      username: dto.username,
      propagation: dto.propagation,
    });
  }

  @Delete()
  @ApiContractResponse(AUTH_PATTERNS.deleteAccount)
  @ApiProblemResponses({ auth: true })
  remove(@AuthUser() user: CurrentUser): Promise<DeleteAccountResult> {
    return this.aboutTheCaller<DeleteAccountResult>(
      AUTH_PATTERNS.deleteAccount,
      { userId: user.userId }
    );
  }

  // --- Shopping profiles (plan 0049, section 6) ------------------------------
  //
  // On this controller because they are the caller's own settings, like the two
  // routes above, and reaching **core** rather than auth: core owns the profile
  // (section 2), auth is deliberately identity only.
  //
  // They use `nats.send` directly and not `aboutTheCaller`, and that is the
  // point of the distinction. That helper turns every downstream "not found"
  // into a 401, which is right for the routes keyed on nothing but the token: a
  // missing account there can only mean the credential is dead. Here a "not
  // found" has a second, ordinary meaning — a profile id that is not yours
  // (section 1.3) — and answering 401 to it would sign the user out for asking
  // about somebody else's profile.

  /**
   * The caller's profiles, in the order the selector shows them.
   *
   * **The first call creates the default one** (plan 0049, section 1.3), so a
   * brand new account reads one profile rather than none: `name` null, nothing
   * else set, and the client renders its localized default name.
   */
  @Get('shopping-profiles')
  @ApiContractResponse(PROFILE_PATTERNS.list)
  @ApiProblemResponses({ auth: true })
  listProfiles(
    @AuthUser() user: CurrentUser
  ): Promise<ShoppingProfileListResult> {
    return this.nats.send<ShoppingProfileListResult>(PROFILE_PATTERNS.list, {
      userId: user.userId,
    });
  }

  /**
   * Mint a profile. Never the default one: a new profile takes its place in the
   * list and moving the default is `POST :id/default`, on purpose.
   */
  @Post('shopping-profiles')
  @ApiContractResponse(PROFILE_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ auth: true, body: true, conflict: true })
  async createProfile(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateShoppingProfileDto
  ): Promise<ShoppingProfileView> {
    const created = await this.nats.send<ShoppingProfileView>(
      PROFILE_PATTERNS.create,
      { userId: user.userId, ...dto }
    );
    await this.scopes.invalidate(user.userId);
    return created;
  }

  /**
   * Edit one. The three collections are full replacements, which is what the
   * page does anyway: it holds the whole list of postal codes and saves it.
   */
  @Patch('shopping-profiles/:id')
  @ApiContractResponse(PROFILE_PATTERNS.update)
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  async updateProfile(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateShoppingProfileDto
  ): Promise<ShoppingProfileView> {
    const updated = await this.nats.send<ShoppingProfileView>(
      PROFILE_PATTERNS.update,
      { userId: user.userId, profileId: id, ...dto }
    );
    await this.scopes.invalidate(user.userId);
    return updated;
  }

  /**
   * Add one postal code, and optionally the ones near it (plan 0062).
   *
   * A route of its own beside the replacement collection on `PATCH`, because a
   * profile's codes are no longer all the user's. The derived ones are the
   * server's: the client never states them, so it cannot lose them by omission
   * or promote them by echoing them back.
   *
   * Adding a code the profile already holds is not an error. One that is already
   * derived is **promoted** to the user's, its suppression cleared, which is also
   * the way back from having removed it.
   */
  @Post('shopping-profiles/:id/postal-codes')
  @ApiContractResponse(PROFILE_PATTERNS.addPostalCode, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    body: true,
    notFound: true,
    conflict: true,
  })
  async addPostalCode(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddPostalCodeDto
  ): Promise<ShoppingProfileView> {
    const profile = await this.nats.send<ShoppingProfileView>(
      PROFILE_PATTERNS.addPostalCode,
      { userId: user.userId, profileId: id, ...dto }
    );
    await this.scopes.invalidate(user.userId);
    return profile;
  }

  /**
   * Remove one postal code, whoever it belongs to.
   *
   * It takes no argument saying how. A code the user added is deleted and the
   * codes it was justifying are pruned; a derived one is suppressed instead, so
   * the recompute cannot put it straight back. Which of those happens follows
   * from the row's own source, which the server knows and the client should not
   * have to (plan 0062, sections 3.1 and 6).
   */
  @Delete('shopping-profiles/:id/postal-codes/:postalCode')
  @ApiContractResponse(PROFILE_PATTERNS.removePostalCode)
  @ApiProblemResponses({ auth: true, notFound: true })
  async removePostalCode(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('postalCode') postalCode: string
  ): Promise<ShoppingProfileView> {
    const profile = await this.nats.send<ShoppingProfileView>(
      PROFILE_PATTERNS.removePostalCode,
      { userId: user.userId, profileId: id, postalCode }
    );
    await this.scopes.invalidate(user.userId);
    return profile;
  }

  /**
   * Say what this profile thinks of several shops at once (plan 0064, section
   * 5).
   *
   * **A partial write, and a PUT rather than a PATCH**, because each shop it
   * names is stated in full: the body says what those shops are, not how to
   * change them. Shops it does not name keep whatever they had, which is what
   * separates it from the collections on the profile body: a profile can see
   * hundreds of shops, and a replacement would make one toggle require the
   * client to send every one of them.
   *
   * Switching a shop back on deletes its row, because absence already means
   * included. Answers the whole profile, so a client that toggled three shops
   * has the profile the toggles produced.
   */
  @Put('shopping-profiles/:id/locations')
  @ApiContractResponse(PROFILE_PATTERNS.setLocationPreferences)
  @ApiProblemResponses({
    auth: true,
    body: true,
    notFound: true,
    conflict: true,
  })
  async setProfileLocations(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: SetProfileLocationsDto
  ): Promise<ShoppingProfileView> {
    const profile = await this.nats.send<ShoppingProfileView>(
      PROFILE_PATTERNS.setLocationPreferences,
      { userId: user.userId, profileId: id, locations: dto.locations }
    );
    // The exclusions narrow rung one of scope resolution (plan 0064, section 3),
    // so a stale cached resolution would keep quoting a price from a shop the
    // caller has just refused.
    await this.scopes.invalidate(user.userId);
    return profile;
  }

  /**
   * Move the default. Setting it on the profile that holds it already answers.
   *
   * A POST that creates nothing, and it still answers 201, because every POST in
   * this gateway does: the document asserts the status from the verb rather than
   * per route, and one route quietly answering 200 would be the exception a
   * client author does not read about.
   */
  @Post('shopping-profiles/:id/default')
  @ApiContractResponse(PROFILE_PATTERNS.setDefault, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, notFound: true })
  async setDefaultProfile(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ShoppingProfileView> {
    const profile = await this.nats.send<ShoppingProfileView>(
      PROFILE_PATTERNS.setDefault,
      { userId: user.userId, profileId: id }
    );
    await this.scopes.invalidate(user.userId);
    return profile;
  }

  /**
   * Delete one. The **last** profile cannot be deleted (a 409), and deleting the
   * default promotes the oldest remaining, so there is always exactly one.
   */
  @Delete('shopping-profiles/:id')
  @ApiContractResponse(PROFILE_PATTERNS.delete)
  @ApiProblemResponses({ auth: true, notFound: true, conflict: true })
  async removeProfile(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    const result = await this.nats.send<{ id: string }>(
      PROFILE_PATTERNS.delete,
      { userId: user.userId, profileId: id }
    );
    await this.scopes.invalidate(user.userId);
    return result;
  }
}
