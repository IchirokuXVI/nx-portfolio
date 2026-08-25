import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import { ApiUrl } from './api-url';

describe('ApiUrl', () => {
  let urls: ApiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
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
