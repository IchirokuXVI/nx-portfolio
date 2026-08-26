import {
  Controller,
  Get,
  Inject,
  Module,
  type DynamicModule,
  type Provider,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TerminusModule,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import { ReadinessState } from './readiness-state';

/**
 * A readiness indicator is any Terminus check. Services contribute their own
 * (DB for auth/core, NATS for all, downstream readiness for gateway/realtime) as
 * those clients are wired in later plans. The factory may inject Terminus
 * indicators (declare them in `inject`, with `imports` for any extra module they
 * need) so a service can build a DB ping or a microservice probe.
 */
export interface ReadinessConfig {
  imports?: DynamicModule['imports'];
  inject?: unknown[];
  useFactory: (...args: unknown[]) => HealthIndicatorFunction[];
}

export const READINESS_INDICATORS = Symbol('LUNA_READINESS_INDICATORS');

/** Heap ceiling for the baseline readiness check (512 MB). */
const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;

/**
 * Health endpoints (plan 0004, section 6). `GET /health/live` reports the process
 * is up; `GET /health/ready` reports dependencies are reachable. Kubernetes points
 * its liveness and readiness probes at these, which is what makes the zero
 * downtime rollout in 0002 safe.
 */
// Kept out of the published OpenAPI document (plan 0019, section 3): these are
// Kubernetes probes, not part of the public API, and their body is Terminus's
// own shape rather than anything the contracts library describes. Excluding them
// is what lets "every documented route has a contract backed response" be an
// unconditional assertion instead of one with an exemption list.
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly readinessState: ReadinessState,
    @Inject(READINESS_INDICATORS)
    private readonly readiness: HealthIndicatorFunction[]
  ) {}

  /** Liveness: the event loop is turning and can answer. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /**
   * Readiness: the baseline heap check plus every dependency indicator the
   * service registered. On `SIGTERM` graceful shutdown flips this to not ready so
   * the proxy stops routing new traffic (section 7).
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.readinessState.check('shutdown'),
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      ...this.readiness,
    ]);
  }
}

/**
 * Wires the shared health controller into a service. Pass `readiness` to add the
 * service's dependency checks (for example a TypeORM ping or a NATS connection
 * probe) once those clients exist; the baseline liveness and heap checks work with
 * no configuration.
 */
@Module({})
export class PlatformHealthModule {
  static forRoot(options?: {
    readiness?: ReadinessConfig;
    imports?: DynamicModule['imports'];
  }): DynamicModule {
    const readinessProvider: Provider = options?.readiness
      ? {
          provide: READINESS_INDICATORS,
          inject: options.readiness.inject as never,
          useFactory: options.readiness.useFactory,
        }
      : { provide: READINESS_INDICATORS, useValue: [] };

    return {
      module: PlatformHealthModule,
      imports: [
        TerminusModule,
        ...(options?.readiness?.imports ?? []),
        ...(options?.imports ?? []),
      ],
      controllers: [HealthController],
      providers: [ReadinessState, readinessProvider],
    };
  }
}
