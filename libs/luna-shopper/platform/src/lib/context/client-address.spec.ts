import { Controller, Get, Req, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { clientAddress, trustReverseProxy } from './client-address';

/**
 * The client is the entry the proxy appended, never one the client wrote.
 *
 * The throttler keys on `req.ip` and the logs on `clientAddress`, so both are
 * pinned here against a real Express app, with the same headers, to keep them
 * answering the same address.
 */
describe('clientAddress', () => {
  it('answers the socket address when no proxy forwarded the request', () => {
    expect(clientAddress(undefined, '10.0.0.7')).toBe('10.0.0.7');
    expect(clientAddress('', '10.0.0.7')).toBe('10.0.0.7');
  });

  it('answers the entry the proxy appended', () => {
    expect(clientAddress('203.0.113.9', '10.42.0.5')).toBe('203.0.113.9');
  });

  it('ignores whatever the client put in front of it', () => {
    expect(clientAddress('1.2.3.4, 203.0.113.9', '10.42.0.5')).toBe(
      '203.0.113.9'
    );
    expect(clientAddress(' 1.2.3.4 ,5.6.7.8,  203.0.113.9 ', '10.42.0.5')).toBe(
      '203.0.113.9'
    );
  });
});

@Controller('whoami')
class WhoAmIController {
  @Get()
  whoami(@Req() req: { ip?: string }): { ip?: string } {
    return { ip: req.ip };
  }
}

describe('trustReverseProxy', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WhoAmIController],
    }).compile();
    app = moduleRef.createNestApplication();
    trustReverseProxy(app);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const ipFor = async (forwardedFor?: string) => {
    const response = await fetch(`${base}/whoami`, {
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    return ((await response.json()) as { ip?: string }).ip;
  };

  it('makes req.ip the entry the proxy appended', async () => {
    expect(await ipFor('203.0.113.9')).toBe('203.0.113.9');
  });

  it('does not let a client choose its own address', async () => {
    expect(await ipFor('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('agrees with clientAddress on the same header', async () => {
    const header = '1.2.3.4, 5.6.7.8, 203.0.113.9';
    expect(await ipFor(header)).toBe(clientAddress(header, undefined));
  });

  it('falls back to the socket when nothing was forwarded', async () => {
    expect(await ipFor()).toMatch(/127\.0\.0\.1$/);
  });
});
