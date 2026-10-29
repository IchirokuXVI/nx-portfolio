import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import { OperatorSettingsApi } from './operator-settings-api';

/**
 * What a deployment states about itself (backend `0231`, section 2; velista `0172`,
 * target 1).
 *
 * One method, one public route. No id and no token: the answer is the same for
 * everybody, signed in or not.
 */
export interface OperatorSettingsServiceI {
  /**
   * The settings (`GET /v1/legal/settings`), or null when the answer is one this
   * build cannot read. A request that fails rejects.
   */
  read(): Promise<OperatorSettings | null>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching `ACCOUNT_SERVICE` for the reason recorded
 * there: a wrong default that quietly works is worse than one that fails loudly.
 */
export const OPERATOR_SETTINGS_SERVICE = serviceToken<OperatorSettingsServiceI>(
  'OPERATOR_SETTINGS_SERVICE',
  () => inject(OperatorSettingsApi)
);
