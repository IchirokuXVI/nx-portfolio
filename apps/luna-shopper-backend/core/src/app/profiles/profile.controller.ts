import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PROFILE_PATTERNS,
  type CreateShoppingProfileRequest,
  type ListShoppingProfilesRequest,
  type ProfileScopeSelector,
  type ResolveProfileScopesRequest,
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

  /** The gateway's call before a catalog read (plan 0049, section 2.1). */
  @MessagePattern(PROFILE_PATTERNS.resolveScopes)
  resolveScopes(
    @Payload() req: ResolveProfileScopesRequest
  ): Promise<ProfileScopeSelector> {
    return this.profiles.resolveScopes(req);
  }
}
