import { toOperatorSettings } from './operator-mappers';

/** A body in the shape backend `0231` section 2 answers, with invented values. */
function body(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    appName: 'Example Shopper',
    controllerName: 'Example Controller',
    contactEmail: 'privacy@example.org',
    published: true,
    terms: {
      version: '2026-10-29',
      updatedOn: '2026-10-29',
      acceptanceRequired: false,
    },
    privacy: { updatedOn: '2026-10-29' },
    features: {
      googleSignIn: true,
      assistant: true,
      transcription: false,
      offsiteBackups: true,
      supportAccess: false,
    },
    processors: {
      hosting: 'Example Hosting',
      email: 'Example Mail',
      aiText: 'anthropic',
      offsiteBackups: null,
    },
    retention: {
      auditTrailDays: 180,
      adminLoginFailureDays: 90,
      expiredGrantDays: 14,
      applicationLogDays: 30,
      assistantLogDays: 7,
      backupDays: 14,
    },
    ...overrides,
  };
}

describe('toOperatorSettings (velista 0172, target 1)', () => {
  it('maps a full body into the model', () => {
    expect(toOperatorSettings(body())).toEqual({
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
        transcription: false,
        offsiteBackups: true,
        supportAccess: false,
      },
      processors: {
        hosting: 'Example Hosting',
        email: 'Example Mail',
        aiText: 'anthropic',
        offsiteBackups: null,
      },
      retention: {
        auditTrailDays: 180,
        adminLoginFailureDays: 90,
        expiredGrantDays: 14,
        applicationLogDays: 30,
        assistantLogDays: 7,
        backupDays: 14,
      },
    });
  });

  it('is null for anything that is not an object', () => {
    expect(toOperatorSettings(null)).toBeNull();
    expect(toOperatorSettings('settings')).toBeNull();
    expect(toOperatorSettings([])).toBeNull();
  });

  it('is null without an app name or a terms version', () => {
    expect(toOperatorSettings(body({ appName: undefined }))).toBeNull();
    expect(toOperatorSettings(body({ appName: '  ' }))).toBeNull();
    expect(
      toOperatorSettings(body({ terms: { updatedOn: '2026-10-29' } }))
    ).toBeNull();
    expect(toOperatorSettings(body({ terms: undefined }))).toBeNull();
  });

  it('is null when a retention number is not a whole number of days', () => {
    const retention = body()['retention'] as Record<string, unknown>;

    expect(
      toOperatorSettings(
        body({ retention: { ...retention, auditTrailDays: 1.5 } })
      )
    ).toBeNull();
    expect(
      toOperatorSettings(
        body({ retention: { ...retention, expiredGrantDays: '14' } })
      )
    ).toBeNull();
    expect(
      toOperatorSettings(
        body({ retention: { ...retention, applicationLogDays: undefined } })
      )
    ).toBeNull();
    expect(
      toOperatorSettings(body({ retention: { ...retention, backupDays: -1 } }))
    ).toBeNull();
    expect(toOperatorSettings(body({ retention: undefined }))).toBeNull();
  });

  it('reads a missing or unreadable admin login period as null, not as a failure', () => {
    const retention = body()['retention'] as Record<string, unknown>;
    const missing = toOperatorSettings(
      body({ retention: { ...retention, adminLoginFailureDays: undefined } })
    );
    const unreadable = toOperatorSettings(
      body({ retention: { ...retention, adminLoginFailureDays: 1.5 } })
    );

    // No document prints it, so the flags plans 0173 and 0174 read stay readable.
    expect(missing).not.toBeNull();
    expect(missing?.retention.adminLoginFailureDays).toBeNull();
    expect(missing?.features.googleSignIn).toBe(true);
    expect(unreadable?.retention.adminLoginFailureDays).toBeNull();
  });

  it('reads a null backup period as off site backups being off', () => {
    const retention = body()['retention'] as Record<string, unknown>;

    expect(
      toOperatorSettings(
        body({ retention: { ...retention, backupDays: null } })
      )?.retention.backupDays
    ).toBeNull();
  });

  it('reads a missing flag as off, so a missing field never offers a feature', () => {
    const settings = toOperatorSettings(
      body({ features: { assistant: 'yes' } })
    );

    expect(settings?.features).toEqual({
      googleSignIn: false,
      assistant: false,
      transcription: false,
      offsiteBackups: false,
      supportAccess: false,
    });
    expect(
      toOperatorSettings(body({ terms: { version: 'v' } }))?.terms
        .acceptanceRequired
    ).toBe(false);
  });

  it('maps an AI provider it does not know to null', () => {
    const processors = body()['processors'] as Record<string, unknown>;

    expect(
      toOperatorSettings(
        body({ processors: { ...processors, aiText: 'other' } })
      )?.processors.aiText
    ).toBeNull();
    // The wire has served `anthropic` alone since backend 0236, and the policy's
    // training sentence holds for Anthropic only, so `google` is not named either.
    expect(
      toOperatorSettings(
        body({ processors: { ...processors, aiText: 'google' } })
      )?.processors.aiText
    ).toBeNull();
  });

  it('is unpublished, not failed, when the operator published nothing', () => {
    const settings = toOperatorSettings(
      body({ published: false, controllerName: null, contactEmail: null })
    );

    expect(settings).not.toBeNull();
    expect(settings?.published).toBe(false);
  });

  it('is unpublished when the flag says so but a value it needs is blank', () => {
    expect(toOperatorSettings(body({ controllerName: '' }))?.published).toBe(
      false
    );
    expect(toOperatorSettings(body({ contactEmail: null }))?.published).toBe(
      false
    );
  });

  it('reads an unreadable date as null', () => {
    const settings = toOperatorSettings(
      body({
        terms: { version: '2026-10-29', updatedOn: '29/10/2026' },
        privacy: {},
      })
    );

    expect(settings?.terms.updatedOn).toBeNull();
    expect(settings?.privacyUpdatedOn).toBeNull();
  });
});
