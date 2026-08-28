import { metrics, type Attributes } from '@opentelemetry/api';

/**
 * Declared metric instruments (plan 0016, section 5.3).
 *
 * The standard way a metrics system becomes unusable and expensive is an
 * unbounded label: every distinct combination creates a permanent time series.
 * So the helpers here do not take an open attribute object. An instrument
 * declares its label set up front, the declaration throws on a label that is
 * known to be unbounded, and recording throws on a label that was not declared.
 *
 * High cardinality identifiers belong on **spans**, where they are free and
 * genuinely useful. That division of labour is the point: traces answer "what
 * happened to this one request", metrics answer "how is the system doing".
 */

/**
 * Labels that are always wrong, because each one grows without bound. Compared
 * case insensitively and ignoring `_`/`.` separators, so `zoneId`, `zone_id` and
 * `zone.id` are all refused.
 */
const FORBIDDEN_LABELS: ReadonlySet<string> = new Set([
  'userid',
  'username',
  'zoneid',
  'listid',
  'lineid',
  'itemid',
  'commentid',
  'correlationid',
  'traceid',
  'spanid',
  'sessionid',
  'socketid',
  'email',
  'ip',
  // Raw request paths. The route *template* is the labelled value; the resolved
  // path is not.
  'path',
  'url',
  'httptarget',
  'httpurl',
  'target',
]);

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[._-]/g, '');
}

/** The meter every platform instrument is created on. */
const METER_NAME = '@portfolio/luna-shopper/platform';

function meter() {
  return metrics.getMeter(METER_NAME);
}

/** Values a label may take. Anything else would not serialize to a label. */
export type LabelValue = string | number | boolean;

/** The recording argument: exactly the declared labels, nothing else. */
export type DeclaredLabels<Labels extends readonly string[]> = Record<
  Labels[number],
  LabelValue
>;

export interface DeclaredCounter<Labels extends readonly string[]> {
  add(value: number, labels: DeclaredLabels<Labels>): void;
}

export interface DeclaredHistogram<Labels extends readonly string[]> {
  record(value: number, labels: DeclaredLabels<Labels>): void;
}

export interface MetricDeclaration<Labels extends readonly string[]> {
  name: string;
  description: string;
  /** UCUM unit, e.g. `ms`, `By`, `1`. */
  unit?: string;
  /** The complete, bounded label set. Recording anything else throws. */
  labels: Labels;
}

function assertDeclarable(declaration: MetricDeclaration<readonly string[]>) {
  for (const label of declaration.labels) {
    if (FORBIDDEN_LABELS.has(normalizeLabel(label))) {
      throw new Error(
        `Metric "${declaration.name}" declares the unbounded label "${label}". ` +
          `High cardinality identifiers belong on spans, not on metrics (plan 0016, section 5.3).`
      );
    }
  }
}

function toAttributes(
  declaration: MetricDeclaration<readonly string[]>,
  labels: Record<string, LabelValue>
): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!declaration.labels.includes(key)) {
      throw new Error(
        `Metric "${declaration.name}" was given the undeclared label "${key}". ` +
          `Declared labels: ${declaration.labels.join(', ') || '(none)'}.`
      );
    }
    attributes[key] = value;
  }
  return attributes;
}

/** Declares a monotonically increasing counter with a bounded label set. */
export function declareCounter<const Labels extends readonly string[]>(
  declaration: MetricDeclaration<Labels>
): DeclaredCounter<Labels> {
  assertDeclarable(declaration);
  let instrument: ReturnType<ReturnType<typeof meter>['createCounter']>;

  return {
    add(value, labels) {
      instrument ??= meter().createCounter(declaration.name, {
        description: declaration.description,
        unit: declaration.unit,
      });
      instrument.add(value, toAttributes(declaration, labels));
    },
  };
}

/** Declares a duration/size histogram with a bounded label set. */
export function declareHistogram<const Labels extends readonly string[]>(
  declaration: MetricDeclaration<Labels>
): DeclaredHistogram<Labels> {
  assertDeclarable(declaration);
  let instrument: ReturnType<ReturnType<typeof meter>['createHistogram']>;

  return {
    record(value, labels) {
      instrument ??= meter().createHistogram(declaration.name, {
        description: declaration.description,
        unit: declaration.unit,
      });
      instrument.record(value, toAttributes(declaration, labels));
    },
  };
}

/**
 * Declares an observable gauge sampled on collection. Used for the values that
 * are a level rather than an event: connected sockets, pool saturation, consumer
 * lag (section 5.2). The callback runs on every scrape, so it must be cheap and
 * must not throw.
 */
export function declareGauge<const Labels extends readonly string[]>(
  declaration: MetricDeclaration<Labels>,
  observe: () => Iterable<{ value: number; labels: DeclaredLabels<Labels> }>
): void {
  assertDeclarable(declaration);
  const gauge = meter().createObservableGauge(declaration.name, {
    description: declaration.description,
    unit: declaration.unit,
  });

  gauge.addCallback((result) => {
    for (const sample of observe()) {
      result.observe(
        sample.value,
        toAttributes(declaration, sample.labels as Record<string, LabelValue>)
      );
    }
  });
}
