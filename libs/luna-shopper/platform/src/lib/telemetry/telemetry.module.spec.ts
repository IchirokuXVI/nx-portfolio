import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { enableApiVersioning } from '../versioning/versioning';
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
} from './telemetry-runtime';
import { readTelemetryConfig } from './telemetry.config';
import { TelemetryModule } from './telemetry.module';

/**
 * Contract test for the scrape endpoint (plan 0016, sections 5.1 and 10).
 *
 * Each of the three exclusions the plan calls out is a real bug if forgotten and
 * none of them is visible by reading the controller, so each gets an assertion
 * against a running app rather than against a decorator.
 */

/** Stands in for a real service route, to prove the throttler is actually on. */
@Controller('zones')
class ThrottledController {
  @Get()
  list() {
    return [];
  }
}

describe('metrics endpoint', () => {
  let app: INestApplication;
  let baseUrl: string;
  let meterProvider: MeterProvider;

  async function startApp(withExporter: boolean): Promise<void> {
    if (withExporter) {
      const exporter = new PrometheusExporter({ preventServerStart: true });
      meterProvider = new MeterProvider({ readers: [exporter] });
      meterProvider
        .getMeter('test')
        .createCounter('luna_test_messages_total', {
          description: 'A counter, so the scrape has something to serialize.',
        })
        .add(1, { subject: 'zone.updated' });

      registerTelemetryRuntime({
        config: readTelemetryConfig({}),
        prometheusExporter: exporter,
        shutdown: () => Promise.resolve(),
      });
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        // One request per minute, so a second call to a throttled route is a 429
        // and the /metrics assertions below mean something.
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 1 }],
        }),
        TelemetryModule.forRoot({ serviceName: 'luna-shopper-backend-test' }),
      ],
      controllers: [ThrottledController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    // URI versioning is on, the way the gateway and realtime run.
    enableApiVersioning(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
  }

  afterEach(async () => {
    await app?.close();
    await meterProvider?.shutdown();
    resetTelemetryRuntime();
  });

  describe('with metrics on', () => {
    beforeEach(() => startApp(true));

    it('answers a scrape in Prometheus exposition format, with no token', async () => {
      const response = await fetch(`${baseUrl}/metrics`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(body).toContain('# HELP luna_test_messages_total');
      expect(body).toContain('# TYPE luna_test_messages_total counter');
      expect(body).toMatch(/luna_test_messages_total\{[^}]*} 1/);
    });

    it('is not rate limited, so a scrape never shows up as a gap', async () => {
      // The throttler is genuinely active: the second call to a normal route is
      // refused.
      expect((await fetch(`${baseUrl}/zones`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/zones`)).status).toBe(429);

      // A scrape every fifteen seconds must never consume a bucket.
      for (let i = 0; i < 5; i += 1) {
        expect((await fetch(`${baseUrl}/metrics`)).status).toBe(200);
      }
    });

    it('is not URL versioned, so a major bump cannot break the scrape config', async () => {
      expect((await fetch(`${baseUrl}/v1/metrics`)).status).toBe(404);
    });

    it('is absent from the API documentation', () => {
      const document = SwaggerModule.createDocument(app, {
        openapi: '3.0.0',
        info: { title: 'test', version: '1' },
        paths: {},
      });

      expect(Object.keys(document.paths)).not.toContain('/metrics');
    });
  });

  describe('with metrics off', () => {
    beforeEach(() => startApp(false));

    it('answers 404 rather than an empty 200, so a bad scrape stays visible', async () => {
      expect((await fetch(`${baseUrl}/metrics`)).status).toBe(404);
    });
  });
});
