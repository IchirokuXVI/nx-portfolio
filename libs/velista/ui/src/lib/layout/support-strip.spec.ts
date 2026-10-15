import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { SupportStrip, timeLeftCopy } from './support-strip';

const MIN = 60_000;
const FILES: Record<string, unknown> = { en, es };

/** The asset's own string, with its `{{values}}` filled, as i18next fills them. */
function translate(
  lang: string,
  key: string,
  values: Record<string, unknown> = {}
): string {
  const found = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      FILES[lang]
    );
  if (typeof found !== 'string') {
    throw new Error(`${lang} has no string at ${key}`);
  }
  return found.replace(/\{\{(\w+)\}\}/g, (_all, name: string) =>
    String(values[name])
  );
}

async function render(
  lang: string,
  untilMs: number
): Promise<ComponentFixture<SupportStrip>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SupportStrip, RokuTranslatorTestingModule.forTesting()],
    providers: [
      {
        provide: RokuTranslatorService,
        useValue: {
          locale: signal(lang),
          loaded: signal(true),
          getLocale: () => lang,
          t: (
            key: string,
            _ns?: string,
            _locale?: string,
            values?: Record<string, unknown>
          ) => translate(lang, key, values),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SupportStrip);
  fixture.componentRef.setInput('username', 'marta_r');
  fixture.componentRef.setInput('until', new Date(untilMs));
  fixture.detectChanges();
  return fixture;
}

function text(fixture: ComponentFixture<SupportStrip>, selector: string) {
  return (
    (fixture.nativeElement as HTMLElement)
      .querySelector(selector)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

// Velista `0133`, target 5.
describe('timeLeftCopy', () => {
  const now = 1_000_000_000_000;

  it.each([
    [
      102 * MIN + 30_000,
      'support.strip.leftHoursMinutes',
      { hours: 1, minutes: 42 },
    ],
    [120 * MIN, 'support.strip.leftHours', { hours: 2 }],
    [42 * MIN + 59_999, 'support.strip.leftMinutes', { minutes: 42 }],
    [MIN, 'support.strip.leftMinutes', { minutes: 1 }],
    [MIN - 1, 'support.strip.leftUnderMinute', {}],
    [-5_000, 'support.strip.leftUnderMinute', {}],
  ])('reads %i ms left as %s', (left, key, params) => {
    expect(timeLeftCopy(now + left, now)).toEqual({ key, params });
  });
});

describe('SupportStrip', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    [
      'en',
      'Viewing as marta_r',
      ['1 h 42 min left', '42 min left', 'Less than a minute left'],
    ],
    [
      'es',
      'Viendo como marta_r',
      ['Quedan 1 h 42 min', 'Quedan 42 min', 'Queda menos de un minuto'],
    ],
  ])(
    'counts down on the minute in %s',
    async (lang, who, [hours, minutes, under]) => {
      jest.useFakeTimers();
      const start = Date.now();
      const fixture = await render(lang, start + 102 * MIN + 30_000);

      expect(text(fixture, '.who')).toBe(who);
      expect(text(fixture, '.left')).toBe(hours);

      // Sixty minutes on: forty two minutes and a half left.
      jest.advanceTimersByTime(60 * MIN);
      fixture.detectChanges();
      expect(text(fixture, '.left')).toBe(minutes);

      // Forty two minutes on: the last half minute.
      jest.advanceTimersByTime(42 * MIN);
      fixture.detectChanges();
      expect(text(fixture, '.left')).toBe(under);
    }
  );

  it('changes on the minute and not before', async () => {
    jest.useFakeTimers();
    const start = Date.now();
    const fixture = await render('en', start + 42 * MIN + 10_000);

    expect(text(fixture, '.left')).toBe('42 min left');

    jest.advanceTimersByTime(9_000);
    fixture.detectChanges();
    expect(text(fixture, '.left')).toBe('42 min left');

    jest.advanceTimersByTime(2_000);
    fixture.detectChanges();
    expect(text(fixture, '.left')).toBe('41 min left');
  });

  it('has End as its only control, and says when it is pressed', async () => {
    const fixture = await render('en', Date.now() + 90 * MIN);
    const host = fixture.nativeElement as HTMLElement;
    const ended = jest.fn();
    fixture.componentInstance.end.subscribe(ended);

    const controls = host.querySelectorAll('button, a, input, [tabindex]');
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent?.trim()).toBe('End');

    (controls[0] as HTMLButtonElement).click();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('is a labelled region and not a live one, so the clock is not read out', async () => {
    const fixture = await render('en', Date.now() + 90 * MIN);
    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector('section');

    expect(region?.getAttribute('aria-label')).toBe('Support session');
    expect(
      host.querySelector('[aria-live], [role="status"], [role="alert"]')
    ).toBeNull();
  });
});
