import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { HealthCheckError, type HealthIndicatorResult } from '@nestjs/terminus';

/**
 * The app half of graceful shutdown (plan 0004, section 7).
 *
 * On `SIGTERM` Nest runs shutdown hooks; this flips readiness to not ready so the
 * reverse proxy stops routing new traffic while in flight requests finish and the
 * NATS/DB connections close. The readiness endpoint consumes it as a Terminus
 * indicator, so a draining pod reports 503 on `/health/ready` (liveness stays up,
 * so Kubernetes does not kill it mid drain).
 */
@Injectable()
export class ReadinessState implements OnApplicationShutdown {
  private draining = false;

  onApplicationShutdown(): void {
    this.draining = true;
  }

  isReady(): boolean {
    return !this.draining;
  }

  /** Terminus indicator: healthy until the process starts draining. */
  check(key: string): HealthIndicatorResult {
    const status: HealthIndicatorResult = {
      [key]: { status: this.draining ? 'down' : 'up' },
    };
    if (this.draining) {
      throw new HealthCheckError('Service is shutting down', status);
    }
    return status;
  }
}
