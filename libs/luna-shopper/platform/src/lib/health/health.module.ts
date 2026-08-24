import {
  Controller,
  Get,
  Inject,
  Module,
  type DynamicModule,
  type Provider,
} from '@nestjs/common';
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
 * those clients are wired in later plans.
 */
export type ReadinessIndicatorFactory = () => HealthIndicatorFunction[];

export const READINESS_INDICATORS = Symbol('LUNA_READINESS_INDICATORS');

/** Heap ceiling for the baseline readiness check (512 MB). */
const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;

/**
 * Health endpoints (plan 0004, section 6). `GET /health/live` reports the process
 * is up; `GET /health/ready` reports dependencies are reachable. Kubernetes points
 * its liveness and readiness probes at these, which is what makes the zero
 * downtime rollout in 0002 safe.
 */
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
    readiness?: ReadinessIndicatorFactory;
    imports?: DynamicModule['imports'];
  }): DynamicModule {
    const readinessProvider: Provider = {
      provide: READINESS_INDICATORS,
      useFactory: () => options?.readiness?.() ?? [],
    };

    return {
      module: PlatformHealthModule,
      imports: [TerminusModule, ...(options?.imports ?? [])],
      controllers: [HealthController],
      providers: [ReadinessState, readinessProvider],
    };
  }
}
