import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import { ApiUrl } from './api-url';

describe('ApiUrl', () => {
  let urls: ApiUrl;

  beforeEach(() => {
    // `ApiUrl` is listed explicitly because it is not `providedIn: 'root'` any more
    // (rule D5): it reads `APP_API_CONFIG`, which only the app layer can supply.
    // The origins here are literals rather than the shared fixture because this spec
    // is about how a base URL and a path are joined, so seeing both ends helps.
    TestBed.configureTestingModule({
      providers: [
        ApiUrl,
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: 'https://gateway.example',
            realtimeBaseUrl: 'https://realtime.example',
          },
        },
      ],
    });
    urls = TestBed.inject(ApiUrl);
  });

  it('builds gateway and realtime URLs from the injected configuration', () => {
    expect(urls.gateway('/v1/zones')).toBe('https://gateway.example/v1/zones');
    expect(urls.realtime('/socket')).toBe('https://realtime.example/socket');
  });

  it('tolerates a path given without a leading slash', () => {
    expect(urls.gateway('v1/zones')).toBe('https://gateway.example/v1/zones');
  });
});
