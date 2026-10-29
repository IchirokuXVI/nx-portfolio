import { Injectable } from '@angular/core';
import type { OperatorSettings } from '@portfolio/velista/models';
import type { OperatorSettingsServiceI } from './operator-settings-service';

/**
 * A deployment that published both documents, with every optional part on, and with
 * invented values. Nothing here is anybody's real deployment.
 */
export const MEMORY_OPERATOR_SETTINGS: OperatorSettings = {
  appName: 'Example Shopper',
  controllerName: 'Example Controller',
  contactEmail: 'privacy@example.org',
  published: true,
  terms: {
    version: '2026-10-29',
    updatedOn: '2026-10-29',
    acceptanceRequired: false,
  },
  privacyUpdatedOn: '2026-10-29',
  features: {
    googleSignIn: true,
    assistant: true,
    transcription: true,
    offsiteBackups: true,
    supportAccess: true,
  },
  processors: {
    hosting: 'Example Hosting',
    email: 'Example Mail',
    aiText: 'anthropic',
    offsiteBackups: 'Example Storage',
  },
  retention: {
    auditTrailDays: 180,
    adminLoginFailureDays: 90,
    expiredGrantDays: 14,
    applicationLogDays: 30,
    assistantLogDays: 7,
    backupDays: 14,
  },
};

/**
 * The operator's settings, in memory. Asked for by name, never a default.
 *
 * `settings` is public so a spec can say what the deployment states, and `failNext`
 * makes the next read reject, the way a request with no answer does.
 */
@Injectable()
export class OperatorSettingsMemory implements OperatorSettingsServiceI {
  settings: OperatorSettings | null = MEMORY_OPERATOR_SETTINGS;
  failNext = false;
  reads = 0;

  async read(): Promise<OperatorSettings | null> {
    this.reads += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('operator settings: no answer');
    }
    return this.settings;
  }
}
