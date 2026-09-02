import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PROFILE_PATTERNS,
  type AddProfilePostalCodeRequest,
  type CreateShoppingProfileRequest,
  type ListShoppingProfilesRequest,
  type ProfileScopeSelector,
  type RemoveProfilePostalCodeRequest,
  type ResolveProfileScopesRequest,
  type SetProfileLocationPreferencesRequest,
  type ShoppingProfileIdRequest,
  type ShoppingProfileListResult,
  type ShoppingProfileView,
  type UpdateShoppingProfileRequest,
} from '@portfolio/luna-shopper/contracts';
import { ProfileService } from './profile.service';

/**
 * Core's shopping profile NATS surface (plan 0049). The gateway is the only
 * caller and every request carries the `userId` a verified token resolved to;
 * ownership is enforced inside {@link ProfileService}, which answers "not found"
 * for somebody else's profile rather than "forbidden".
 */
@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @MessagePattern(PROFILE_PATTERNS.list)
  list(
    @Payload() req: ListShoppingProfilesRequest
  ): Promise<ShoppingProfileListResult> {
    return this.profiles.list(req);
  }

  @MessagePattern(PROFILE_PATTERNS.create)
  create(
    @Payload() req: CreateShoppingProfileRequest
  ): Promise<ShoppingProfileView> {
    return this.profiles.create(req);
  }

  @MessagePattern(PROFILE_PATTERNS.update)
  update(
    @Payload() req: UpdateShoppingProfileRequest
  ): Promise<ShoppingProfileView> {
    return this.profiles.update(req);
  }

  @MessagePattern(PROFILE_PATTERNS.setDefault)
  setDefault(
    @Payload() req: ShoppingProfileIdRequest
  ): Promise<ShoppingProfileView> {
    return this.profiles.setDefault(req);
  }

  @MessagePattern(PROFILE_PATTERNS.delete)
  delete(@Payload() req: ShoppingProfileIdRequest): Promise<{ id: string }> {
    return this.profiles.delete(req);
  }

  /**
   * One code at a time (plan 0062, section 6), beside the replacement collection
   * on `update`. Both answer the whole profile, because one add can write a
   * parent and its neighbours and one remove can prune several.
   */
  @MessagePattern(PROFILE_PATTERNS.addPostalCode)
  addPostalCode(
    @Payload() req: AddProfilePostalCodeRequest
  ): Promise<ShoppingProfileView> {
    return this.profiles.addPostalCode(req);
  }

  /** Delete or suppress, decided by the row's own source and not by the caller. */
  @MessagePattern(PROFILE_PATTERNS.removePostalCode)
  removePostalCode(
    @Payload() req: RemoveProfilePostalCodeRequest
  ): Promise<ShoppingProfileView> {
    return this.profiles.removePostalCode(req);
  }

  /**
   * Several shops at once (plan 0064, section 5), and the only way this axis is
   * written: a partial write rather than a replacement, because the set can run
   * to hundreds and a screen holds a screenful of it.
   */
  @MessagePattern(PROFILE_PATTERNS.setLocationPreferences)
  setLocationPreferences(
    @Payload() req: SetProfileLocationPreferencesRequest
  ): Promise<ShoppingProfileView> {
    return this.profiles.setLocationPreferences(req);
  }

  /** The gateway's call before a catalog read (plan 0049, section 2.1). */
  @MessagePattern(PROFILE_PATTERNS.resolveScopes)
  resolveScopes(
    @Payload() req: ResolveProfileScopesRequest
  ): Promise<ProfileScopeSelector> {
    return this.profiles.resolveScopes(req);
  }
}
