import {
  declareCounter,
  declareGauge,
  declareHistogram,
} from './declared-metrics';

/**
 * The cardinality rule (plan 0016, sections 5.3 and 10). The helpers exist to
 * make the standard way a metrics system becomes unusable hard to reach by
 * accident, so what is tested here is that they actually refuse.
 */
describe('declared metrics', () => {
  it('refuses a label that is known to be unbounded', () => {
    for (const label of ['userId', 'zone_id', 'correlationId', 'path']) {
      expect(() =>
        declareCounter({
          name: 'luna.test.counter',
          description: 'test',
          labels: [label] as const,
        })
      ).toThrow(/unbounded label/);
    }
  });

  it('refuses regardless of how the label is spelled', () => {
    expect(() =>
      declareHistogram({
        name: 'luna.test.histogram',
        description: 'test',
        labels: ['zone.id'] as const,
      })
    ).toThrow(/unbounded label/);
  });

  it('refuses an undeclared label at record time', () => {
    const counter = declareCounter({
      name: 'luna.test.messages',
      description: 'test',
      labels: ['subject'] as const,
    });

    expect(() =>
      // The cast is the test: TypeScript already rejects this, and the runtime
      // check is what catches it when the value comes from somewhere untyped.
      counter.add(1, { subject: 'zone.updated', zoneId: 'z-1' } as never)
    ).toThrow(/undeclared label "zoneId"/);
  });

  it('accepts the declared labels', () => {
    const histogram = declareHistogram({
      name: 'luna.test.duration',
      description: 'test',
      unit: 'ms',
      labels: ['subject', 'outcome'] as const,
    });

    expect(() =>
      histogram.record(12, { subject: 'list.created', outcome: 'success' })
    ).not.toThrow();
  });

  it('accepts fewer labels than declared, for a genuinely absent dimension', () => {
    const counter = declareCounter({
      name: 'luna.test.partial',
      description: 'test',
      labels: ['subject', 'outcome'] as const,
    });

    expect(() =>
      counter.add(1, { subject: 'zone.deleted' } as never)
    ).not.toThrow();
  });

  it('checks a gauge declaration too', () => {
    expect(() =>
      declareGauge(
        {
          name: 'luna.test.gauge',
          description: 'test',
          labels: ['listId'] as const,
        },
        () => []
      )
    ).toThrow(/unbounded label/);
  });
});
