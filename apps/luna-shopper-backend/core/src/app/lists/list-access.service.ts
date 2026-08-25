import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ListRole, ZoneRole } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ListAccess, ListLine, ShoppingList } from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';

/**
 * Authorization for lists, lines and comments (plan 0007, section 4). Every check
 * runs against core's own membership and list-access tables using the token
 * `userId`. Reading a list needs an APPROVED zone membership plus a ListAccess
 * row (or being a manager); writing lines needs WRITER access; managing a list
 * (access/update/delete) is limited to the list creator, a zone admin, or the
 * owner.
 */
@Injectable()
export class ListAccessService {
  constructor(
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    @InjectRepository(ListAccess)
    private readonly access: Repository<ListAccess>,
    @InjectRepository(ListLine)
    private readonly lines: Repository<ListLine>,
    private readonly zoneAuthz: ZoneAuthzService
  ) {}

  async getList(listId: string): Promise<ShoppingList> {
    const list = await this.lists.findOne({ where: { id: listId } });
    if (!list) {
      throw new NotFoundException('List not found');
    }
    return list;
  }

  async getLine(lineId: string): Promise<ListLine> {
    const line = await this.lines.findOne({ where: { id: lineId } });
    if (!line) {
      throw new NotFoundException('Line not found');
    }
    return line;
  }

  /** True when the caller is the list creator or a zone admin/owner. */
  private async isManager(
    list: ShoppingList,
    userId: string
  ): Promise<boolean> {
    if (list.createdByUserId === userId) {
      return true;
    }
    const membership = await this.zoneAuthz.resolve(list.zoneId, userId);
    return (
      !!membership &&
      (membership.role === ZoneRole.OWNER || membership.role === ZoneRole.ADMIN)
    );
  }

  /**
   * Requires the caller to be able to read the list: an approved member who
   * either holds a ListAccess row or is a manager (creator/admin/owner, who can
   * always see a list they govern).
   */
  async requireRead(listId: string, userId: string): Promise<ShoppingList> {
    const list = await this.getList(listId);
    const membership = await this.zoneAuthz.requireApproved(
      list.zoneId,
      userId
    );
    if (await this.isManager(list, userId)) {
      return list;
    }
    const access = await this.access.findOne({
      where: { listId, membershipId: membership.id },
    });
    if (!access) {
      throw new ForbiddenException('You do not have access to this list');
    }
    return list;
  }

  /** Requires WRITER access on the list (plan 0007, section 4). */
  async requireWrite(listId: string, userId: string): Promise<ShoppingList> {
    const list = await this.getList(listId);
    const membership = await this.zoneAuthz.requireApproved(
      list.zoneId,
      userId
    );
    const access = await this.access.findOne({
      where: { listId, membershipId: membership.id },
    });
    if (!access || access.role !== ListRole.WRITER) {
      throw new ForbiddenException('You need writer access to this list');
    }
    return list;
  }

  /** Requires the caller to manage the list (creator, zone admin, or owner). */
  async requireManage(listId: string, userId: string): Promise<ShoppingList> {
    const list = await this.getList(listId);
    await this.zoneAuthz.requireApproved(list.zoneId, userId);
    if (!(await this.isManager(list, userId))) {
      throw new ForbiddenException(
        'Only the list owner or a zone admin can do that'
      );
    }
    return list;
  }
}
