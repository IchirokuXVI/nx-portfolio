import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserKind, type IdentityStats } from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { User } from '../entities';

/**
 * Auth's half of the platform totals (plan 0017, section 8), counted over its own
 * table and published over NATS for the gateway to compose.
 *
 * Reporting `users` as one number would mislead in this product: a guest who
 * created one zone and never came back is a row in `users`, so the honest
 * headline is `registeredUsers` and the client picks. Both are reported rather
 * than one being chosen here.
 */
@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>
  ) {}

  async identity(): Promise<IdentityStats> {
    const row = await this.users
      .createQueryBuilder('u')
      .select('count(*)::int', 'users')
      .addSelect(
        `count(*) FILTER (WHERE u.kind = :registered)::int`,
        'registered'
      )
      .addSelect(`count(*) FILTER (WHERE u.kind = :temporary)::int`, 'temporary')
      .setParameters({
        registered: UserKind.REGISTERED,
        temporary: UserKind.TEMPORARY,
      })
      .getRawOne<{ users: number; registered: number; temporary: number }>();

    return {
      users: row?.users ?? 0,
      registeredUsers: row?.registered ?? 0,
      temporaryUsers: row?.temporary ?? 0,
    };
  }
}
