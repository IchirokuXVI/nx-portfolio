import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { probeCarrefour } from '@portfolio/luna-shopper/carrefour';
import type {
  AdapterKey,
  SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import { probeDeza } from '@portfolio/luna-shopper/deza';
import { probeDia } from '@portfolio/luna-shopper/dia';
import {
  ELJAMON_DEFAULT_POSTAL_CODE,
  probeElJamon,
} from '@portfolio/luna-shopper/eljamon';
import { probeLidl } from '@portfolio/luna-shopper/lidl';
import { probeMercadona } from '@portfolio/luna-shopper/mercadona';
import type { HarvesterConfig } from '../../config/app-config';
import type { SupermarketSource } from '../../entities';
import { TokenBucket } from '../../runner/token-bucket';

/** The six chains a probe exists for (plan 0219, section 3.2). */
export const PROBED_ADAPTER_KEYS = [
  'mercadona-api',
  'dia-api',
  'lidl-api',
  'eljamon-web',
  'deza-web',
  'carrefour-web',
] as const satisfies readonly AdapterKey[];

export type ProbedAdapterKey = (typeof PROBED_ADAPTER_KEYS)[number];

export function isProbedAdapterKey(key: string): key is ProbedAdapterKey {
  return (PROBED_ADAPTER_KEYS as readonly string[]).includes(key);
}

/**
 * The probe of a source row, dispatched on `adapterKey` as
 * `CatalogDiscoveryRunner` dispatches a walk (plan 0219, section 1).
 *
 * It reads the row once and changes nothing on it (section 9): the base URL
 * and the other addresses from `config`, as each runner reads them, the rate
 * from `maxRequestsPerSecond`, and Mercadona's storefront from
 * `mercadonaBaseUrl`. A slot that points a chain at a local recording thus
 * probes the recording. The user agent is the walk's, so the chain sees what
 * the next walk would.
 *
 * `osm-places` and `manual` have no probe, for the reason they have no walk.
 */
@Injectable()
export class SourceProbeDispatcher {
  constructor(private readonly config: ConfigService) {}

  probe(
    source: Pick<
      SupermarketSource,
      'adapterKey' | 'config' | 'maxRequestsPerSecond'
    >,
    signal: AbortSignal
  ): Promise<SourceProbeResult> {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const config = source.config ?? {};
    const rate = Number(source.maxRequestsPerSecond);
    // The bucket a run would hold at this row's rate (section 3.4).
    const bucket = new TokenBucket({
      ratePerSecond: Number.isFinite(rate) && rate > 0 ? rate : 1,
    });
    const acquire = () => bucket.acquire();
    const userAgent = settings.userAgent;
    const baseUrl = readString(config, 'baseUrl');

    switch (source.adapterKey) {
      case 'mercadona-api':
        return this.run.mercadona({
          userAgent,
          baseUrl: settings.mercadonaBaseUrl,
          storesUrl: readString(config, 'storesUrl'),
          totalsUrl: readString(config, 'storesTotalsUrl'),
          acquire,
          signal,
        });
      case 'dia-api':
        // DIA sends a browser user agent of its own by the owner's decision
        // (plan 0174, D1), so it takes none here.
        return this.run.dia({ baseUrl, acquire, signal });
      case 'lidl-api':
        return this.run.lidl({
          userAgent,
          baseUrl,
          storesUrl: readString(config, 'storesUrl'),
          storesApiKey: settings.lidlStoresApiKey,
          acquire,
          signal,
        });
      case 'eljamon-web':
        return this.run.elJamon({
          userAgent,
          baseUrl,
          locatorUrl: readString(config, 'locatorUrl'),
          postalCode:
            readString(config, 'postalCode') ?? ELJAMON_DEFAULT_POSTAL_CODE,
          acquire,
          signal,
        });
      case 'deza-web':
        return this.run.deza({ userAgent, baseUrl, acquire, signal });
      case 'carrefour-web':
        return this.run.carrefour({
          userAgent,
          baseUrl,
          seedPath: readString(config, 'seedPath'),
          delayMs: readPositive(config, 'delayMs'),
          acquire,
          signal,
        });
      default:
        return Promise.reject(
          new Error(`The adapter "${source.adapterKey}" has no probe.`)
        );
    }
  }

  /** The library functions. A seam for the specs, never a setting. */
  protected readonly run = {
    mercadona: probeMercadona,
    dia: probeDia,
    lidl: probeLidl,
    elJamon: probeElJamon,
    deza: probeDeza,
    carrefour: probeCarrefour,
  };
}

function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

function readPositive(
  config: Record<string, unknown>,
  key: string
): number | undefined {
  const value = Number(config[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
