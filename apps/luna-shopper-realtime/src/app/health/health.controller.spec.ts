import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('reports the service as ok', () => {
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'luna-shopper-realtime',
    });
  });
});
