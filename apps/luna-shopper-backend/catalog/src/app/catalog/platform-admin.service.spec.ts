import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import { PlatformAdminService } from './platform-admin.service';

function makeService(adminIds: string[]): PlatformAdminService {
  const config = {
    getOrThrow: () => ({ platformAdminUserIds: adminIds }),
  } as unknown as ConfigService;
  return new PlatformAdminService(config);
}

describe('PlatformAdminService', () => {
  it('recognises a configured admin', () => {
    const svc = makeService(['owner-1', 'owner-2']);
    expect(svc.isAdmin('owner-1')).toBe(true);
    expect(svc.isAdmin('owner-2')).toBe(true);
  });

  it('rejects a non-admin', () => {
    const svc = makeService(['owner-1']);
    expect(svc.isAdmin('someone-else')).toBe(false);
  });

  it('requireAdmin passes for an admin and throws for everyone else', () => {
    const svc = makeService(['owner-1']);
    expect(() => svc.requireAdmin('owner-1')).not.toThrow();
    expect(() => svc.requireAdmin('intruder')).toThrow(ForbiddenException);
  });

  it('an empty allowlist forbids every write', () => {
    const svc = makeService([]);
    expect(svc.isAdmin('anyone')).toBe(false);
    expect(() => svc.requireAdmin('anyone')).toThrow(ForbiddenException);
  });
});
