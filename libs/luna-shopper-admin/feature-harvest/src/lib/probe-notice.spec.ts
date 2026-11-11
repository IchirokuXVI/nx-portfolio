import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ProbeVerdict } from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProbeNotice, probeAge } from './probe-notice';

/**
 * The notice before a start (admin plan 0069, sections 1 and 3). The testing
 * translator answers keys, so the cases assert on the message the notice
 * builds, and the copy is read out of `en.json` itself.
 */
const NOW = Date.parse('2026-11-11T09:00:00.000Z');

const VERDICT: ProbeVerdict = {
  id: 'probe-1',
  status: 'UNREACHABLE',
  startedAt: '2026-11-08T09:00:00.000Z',
  error: 'home: GET https://deza.example/ timed out',
};

function render(chain: string | null, verdict: ProbeVerdict = VERDICT) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ProbeNotice, RokuTranslatorTestingModule.forTesting()],
  });
  const fixture = TestBed.createComponent(ProbeNotice);
  fixture.componentRef.setInput('chain', chain);
  fixture.componentRef.setInput('verdict', verdict);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  return fixture;
}

describe('the probe notice', () => {
  it('names the chain, the age, the status word and the sentence', () => {
    const notice = render('Deza').componentInstance;

    expect(notice.message()).toEqual({
      key: 'harvest.probeNotice.text',
      args: {
        chain: 'Deza',
        age: '3 days ago',
        status: 'harvest.probeNotice.status.UNREACHABLE',
        sentence: 'home: GET https://deza.example/ timed out',
        interpolation: { escapeValue: false },
      },
    });
  });

  it('drops the last clause for a probe that sent no sentence', () => {
    const notice = render('Deza', {
      ...VERDICT,
      error: null,
    }).componentInstance;

    expect(notice.message().key).toBe('harvest.probeNotice.textNoSentence');
  });

  it('says "This chain" and never the id when the chain has no name', () => {
    const notice = render(null).componentInstance;

    expect(notice.message().args['chain']).toBe(
      'harvest.probeNotice.thisChain'
    );
  });

  it('says "just now" for a probe that started this second', () => {
    const notice = render('Deza', {
      ...VERDICT,
      startedAt: new Date(NOW).toISOString(),
    }).componentInstance;

    expect(notice.message().args['age']).toBe('harvest.probeNotice.justNow');
  });

  it('is a status with the warning glyph, and nothing to press', () => {
    const host: HTMLElement = render('Deza').nativeElement;

    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('data-probe-notice')).toBe('UNREACHABLE');
    expect(host.querySelector('lib-warning-icon')).not.toBeNull();
    expect(host.querySelector('button, a, [tabindex]')).toBeNull();
  });
});

describe('probeAge', () => {
  const JUST_NOW = 'just now';

  it('is the relative format of the harvest feature', () => {
    expect(probeAge('2026-11-10T09:00:00.000Z', NOW, JUST_NOW, 'en')).toBe(
      'yesterday'
    );
    expect(probeAge('2026-11-11T08:00:00.000Z', NOW, JUST_NOW, 'en')).toBe(
      '1 hour ago'
    );
    expect(probeAge('2026-11-11T08:59:30.000Z', NOW, JUST_NOW, 'en')).toBe(
      '30 seconds ago'
    );
  });

  it('answers its own words for an age of no seconds, never "now"', () => {
    expect(probeAge('2026-11-11T09:00:00.000Z', NOW, JUST_NOW, 'en')).toBe(
      JUST_NOW
    );
    expect(probeAge('2026-11-11T08:59:59.700Z', NOW, JUST_NOW, 'en')).toBe(
      JUST_NOW
    );
  });

  it('reads a start in the future as just now, so the sentence has no hole', () => {
    expect(probeAge('2026-11-12T09:00:00.000Z', NOW, JUST_NOW, 'en')).toBe(
      JUST_NOW
    );
  });

  it('reads a start it cannot parse as just now', () => {
    expect(probeAge('not a date', NOW, JUST_NOW, 'en')).toBe(JUST_NOW);
  });
});

describe('the probe notice copy', () => {
  const { harvest } = JSON.parse(
    readFileSync(join(__dirname, '../../../ui/assets/i18n/en.json'), 'utf8')
  );

  it('holds every key of section 1', () => {
    expect(harvest.probeNotice.text).toBe(
      "{{chain}}'s last probe, {{age}}, was {{status}}: {{sentence}}. A run may store little or mark products wrong. You can start it anyway."
    );
    expect(harvest.probeNotice.textNoSentence).toBe(
      "{{chain}}'s last probe, {{age}}, was {{status}}. A run may store little or mark products wrong. You can start it anyway."
    );
    expect(harvest.probeNotice.justNow).toBe('just now');
    expect(harvest.probeNotice.status).toEqual({
      SHAPE_CHANGED: 'a shape change',
      BLOCKED: 'refused',
      UNREACHABLE: 'unreachable',
      ERROR: 'a fault on our side',
    });
    expect(harvest.schedules.blocked.PROBE_NOT_PASSED).toBe(
      "{{chain}}'s last probe did not pass. The next slot runs a probe first and is skipped if it fails again."
    );
    expect(harvest.schedules.outcome.SKIPPED_PROBE_FAILED).toBe(
      'Skipped, the probe did not pass'
    );
  });

  it('uses no dash as punctuation', () => {
    const words = [
      ...Object.values(harvest.probeNotice).filter(
        (value): value is string => typeof value === 'string'
      ),
      ...(Object.values(harvest.probeNotice.status) as string[]),
      harvest.schedules.blocked.PROBE_NOT_PASSED,
      harvest.schedules.outcome.SKIPPED_PROBE_FAILED,
    ];

    for (const value of words) {
      expect(value).not.toMatch(/[–—]|\s-\s|--/);
    }
  });
});
