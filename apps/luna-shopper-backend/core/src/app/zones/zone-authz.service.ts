import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MembershipStatus, ZoneRole } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ZoneMembership } from '../entities';

/**
 * Authorization for every core operation (plan 0006, section 6). Tokens are
 * verified offline at the gateway; core trusts the `userId` claim and looks up
 * the caller's membership in its own table, so a banned user holding a still
 * valid access token cannot act (plan 0004, section 10). Read/data operations
 * require an APPROVED membership; governance requires OWNER or ADMIN.
 */
@Injectable()
export class ZoneAuthzService {
  constructor(
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>
  ) {}

  /** The caller's membership in a zone, or null. */
  resolve(zoneId: string, userId: string): Promise<ZoneMembership | null> {
    return this.memberships.findOne({ where: { zoneId, userId } });
  }

  /** Requires an APPROVED membership (read/data operations). */
  async requireApproved(
    zoneId: string,
    userId: string
  ): Promise<ZoneMembership> {
    const membership = await this.resolve(zoneId, userId);
    if (!membership) {
      throw new NotFoundException('Zone not found');
    }
    if (membership.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('You are not an approved member');
    }
    return membership;
  }

  /** Requires the caller to be APPROVED and hold one of the given roles. */
  async requireRole(
    zoneId: string,
    userId: string,
    roles: ZoneRole[]
  ): Promise<ZoneMembership> {
    const membership = await this.requireApproved(zoneId, userId);
    if (!roles.includes(membership.role)) {
      throw new ForbiddenException(
        'You do not have permission for this operation'
      );
    }
    return membership;
  }
}
