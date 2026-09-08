import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AdminDashboardResponse } from '@portfolio/luna-shopper/contracts';
import {
  ApiProblemResponses,
  componentRef,
  hoistAdminDashboard,
} from '../docs';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { ActingAdmin } from './current-admin.decorator';

/** Hoisted at module load, so the component exists before the document is built. */
const ADMIN_DASHBOARD_SCHEMA = hoistAdminDashboard();

/**
 * What the back office opens to (plan 0088).
 *
 * One route, composed from four services, each answering a question about its
 * own database. The controller is one method on purpose: the fan out, the merge
 * of the three audit trails and the naming of their actors all live in
 * {@link AdminDashboardService}, which is what the spec drives with a fake NATS
 * client.
 *
 * Behind `AdminJwtGuard` like every admin read, and gated a second time by each
 * service that answers: a route added here without the guard still could not
 * count the user directory, because auth verifies the forwarded token itself.
 */
@ApiTags('admin-dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true })
@Controller({ path: 'admin/dashboard', version: '1' })
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  @ApiOkResponse({
    description:
      'The four dashboard blocks and the merged activity feed. A block is null when that service did not answer, and the response is still 200.',
    schema: componentRef(ADMIN_DASHBOARD_SCHEMA),
  })
  get(@ActingAdmin() admin: CurrentAdmin): Promise<AdminDashboardResponse> {
    return this.dashboard.dashboard(admin);
  }
}
