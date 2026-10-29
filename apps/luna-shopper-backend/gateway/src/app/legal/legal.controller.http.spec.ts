import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AiTextProvider,
  ASSISTANT_PATTERNS,
  LEGAL_TEMPLATES,
  type AssistantCapabilities,
  type LegalSettingsView,
} from '@portfolio/luna-shopper/contracts';
import type { AddressInfo } from 'node:net';
import { legalConfig } from '../config/legal-config';
import { NatsClient } from '../messaging/nats-client';
import { AssistantCapabilitiesProbe } from './assistant-capabilities.probe';
import { LegalController } from './legal.controller';

/**
 * `GET /legal/settings` over real HTTP (plan 0231, section 2): public, cached
 * for five minutes, and answered on every deployment, configured or not. The
 * assistant's half is the last answer the probe kept, and before the first one
 * the route serves assistant on, transcription off.
 */

/** Invented values. The owner's own are never written to a tracked file. */
const CONFIGURED = {
  LEGAL_APP_NAME: 'Example Shopper',
  LEGAL_CONTROLLER_NAME: 'Jane Example',
  LEGAL_CONTACT_EMAIL: 'privacy@example.invalid',
  LEGAL_HOSTING_PROVIDER: 'Example Hosting',
  LEGAL_EMAIL_PROVIDER: 'Example Mail',
  LEGAL_BACKUP_PROVIDER: 'Example Storage',
  LEGAL_TERMS_REVISION: '2099-12-15',
  TERMS_ACCEPTANCE_REQUIRED: 'true',
  LEGAL_OFFSITE_BACKUPS: 'true',
  IMPERSONATION_ENABLED: 'true',
};

async function serve(
  env: NodeJS.ProcessEnv,
  answer: () => Promise<AssistantCapabilities>,
  googleEnabled = false
) {
  const send = jest.fn(async (subject: string) => {
    if (subject !== ASSISTANT_PATTERNS.capabilities) {
      throw new Error(`nothing answers ${subject} here`);
    }
    return answer();
  });
  const app: INestApplication = (
    await Test.createTestingModule({
      controllers: [LegalController],
      providers: [
        AssistantCapabilitiesProbe,
        { provide: NatsClient, useValue: { send } },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => ({
              google: { enabled: googleEnabled },
              legal: legalConfig(env),
            }),
          },
        },
      ],
    }).compile()
  ).createNestApplication({ logger: false });
  await app.init();
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  const probe = app.get(AssistantCapabilitiesProbe);
  const get = async () => {
    const res = await fetch(`http://127.0.0.1:${port}/legal/settings`);
    return {
      status: res.status,
      cacheControl: res.headers.get('cache-control'),
      body: (await res.json()) as LegalSettingsView,
    };
  };
  return { app, get, probe, send };
}

describe('GET /legal/settings', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers an unconfigured deployment with published false and no token', async () => {
    const served = await serve({}, async () => ({
      answers: false,
      hears: false,
      textProvider: null,
    }));
    app = served.app;
    await served.probe.refresh();

    const { status, cacheControl, body } = await served.get();

    expect(status).toBe(200);
    expect(cacheControl).toBe('public, max-age=300');
    expect(body).toEqual({
      appName: 'Luna Shopper',
      controllerName: null,
      contactEmail: null,
      published: false,
      terms: {
        version: LEGAL_TEMPLATES.terms.version,
        updatedOn: LEGAL_TEMPLATES.terms.version,
        acceptanceRequired: false,
      },
      privacy: { updatedOn: LEGAL_TEMPLATES.privacy.updatedOn },
      features: {
        googleSignIn: false,
        assistant: false,
        transcription: false,
        offsiteBackups: false,
        supportAccess: false,
      },
      processors: {
        hosting: null,
        email: null,
        aiText: null,
        offsiteBackups: null,
      },
      retention: {
        auditTrailDays: 180,
        adminLoginFailureDays: 90,
        expiredGrantDays: 14,
        applicationLogDays: 30,
        assistantLogDays: 7,
        backupDays: null,
      },
    });
  });

  it('answers a configured deployment with every value it was given', async () => {
    const served = await serve(
      CONFIGURED,
      async () => ({
        answers: true,
        hears: true,
        textProvider: AiTextProvider.ANTHROPIC,
      }),
      true
    );
    app = served.app;
    await served.probe.refresh();

    const { body } = await served.get();

    expect(body).toMatchObject({
      appName: 'Example Shopper',
      controllerName: 'Jane Example',
      contactEmail: 'privacy@example.invalid',
      published: true,
      terms: {
        version: `${LEGAL_TEMPLATES.terms.version}+2099-12-15`,
        updatedOn: '2099-12-15',
        acceptanceRequired: true,
      },
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
        aiText: AiTextProvider.ANTHROPIC,
        offsiteBackups: 'Example Storage',
      },
      retention: { backupDays: 14 },
    });
  });

  it('serves assistant on and transcription off before the first answer, then the answer', async () => {
    let release: (value: AssistantCapabilities) => void = () => undefined;
    const pending = new Promise<AssistantCapabilities>((resolve) => {
      release = resolve;
    });
    const served = await serve({}, () => pending);
    app = served.app;

    const before = await served.get();
    expect(before.body.features).toMatchObject({
      assistant: true,
      transcription: false,
    });
    expect(before.body.processors.aiText).toBeNull();

    release({
      answers: true,
      hears: true,
      textProvider: AiTextProvider.ANTHROPIC,
    });
    await pending;
    await new Promise((resolve) => setImmediate(resolve));

    const after = await served.get();
    expect(after.body.features).toMatchObject({
      assistant: true,
      transcription: true,
    });
    expect(after.body.processors.aiText).toBe(AiTextProvider.ANTHROPIC);
  });

  it('keeps the last answer when a later question fails', async () => {
    let fail = false;
    const served = await serve({}, async () => {
      if (fail) {
        throw new Error('assistant is away');
      }
      return {
        answers: true,
        hears: false,
        textProvider: AiTextProvider.ANTHROPIC,
      };
    });
    app = served.app;
    await served.probe.refresh();
    fail = true;
    await served.probe.refresh();

    const { body } = await served.get();
    expect(body.processors.aiText).toBe(AiTextProvider.ANTHROPIC);
  });
});
