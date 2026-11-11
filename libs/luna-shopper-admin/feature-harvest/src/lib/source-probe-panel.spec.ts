import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  HarvestMemory,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  RECORD_CONTEXT,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { SourceProbePanel } from './source-probe-panel';
import { SOURCES } from './sources';

/**
 * The warning on the source record page (admin plan 0069, the owner's "Show
 * it"), over the memory back end. Its seed has DEZA's newest finished probe
 * red, Mercadona's green over an older red one, and no probe for Carrefour,
 * whose source is manual.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const DEZA = '33333333-3333-4333-8333-333333333333';

const NAMES: Readonly<Record<string, string>> = {
  [MERCADONA]: 'Mercadona',
  [DEZA]: 'Deza',
};

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

async function render(
  id: string,
  service: HarvestMemory = new HarvestMemory()
): Promise<{
  fixture: ComponentFixture<SourceProbePanel>;
  reads: jest.SpyInstance;
}> {
  const reads = jest.spyOn(service, 'listProbes');
  // What the record page provides, for a source keyed on its chain.
  const context = {
    descriptor: SOURCES,
    id,
    row: signal(null),
    mode: signal('read'),
    reload: async () => undefined,
    countOf: () => null,
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SourceProbePanel, RokuTranslatorTestingModule.forTesting()],
    providers: [
      { provide: HARVEST_SERVICE, useValue: service },
      { provide: RECORD_CONTEXT, useValue: context },
      {
        provide: ResourceReferences,
        useValue: {
          resolve: async (_resource: string, chain: string) =>
            NAMES[chain] === undefined
              ? null
              : { id: chain, title: NAMES[chain] },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SourceProbePanel);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();
  return { fixture, reads };
}

const host = (fixture: ComponentFixture<SourceProbePanel>): HTMLElement =>
  fixture.nativeElement;

describe('the source record page, its last probe', () => {
  it('warns about a chain whose newest finished probe did not pass', async () => {
    const { fixture, reads } = await render(DEZA);

    // One page of ten, for the chain the record is keyed on.
    expect(reads).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledWith(DEZA, { limit: 10 });

    const section = host(fixture).querySelector('[data-source-probe]');
    expect(section?.querySelector('h2')?.textContent?.trim()).toBe(
      'harvest.sources.section.probe'
    );
    const notice = section?.querySelector('[data-probe-notice]');
    expect(notice?.getAttribute('data-probe-notice')).toBe('UNREACHABLE');
    expect(notice?.textContent?.trim()).toBe('harvest.probeNotice.sourceText');
    expect(fixture.componentInstance.chain()).toBe('Deza');
    // A warning and nothing to press: the probe button is another plan's.
    expect(host(fixture).querySelector('button, a')).toBeNull();
  });

  it('draws nothing for a chain whose newest finished probe passed', async () => {
    const { fixture, reads } = await render(MERCADONA);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.verdict()).toBe(null);
    expect(host(fixture).children).toHaveLength(0);
    // Truly empty, no text either, so the record page hides its children
    // (`lib-record-children`) and adds no gap for this panel.
    expect(host(fixture).matches(':empty')).toBe(true);
  });

  it('draws nothing for a source with no probe at all', async () => {
    const { fixture } = await render(CARREFOUR);

    expect(fixture.componentInstance.verdict()).toBe(null);
    expect(host(fixture).children).toHaveLength(0);
  });

  it('reads past a probe in flight to the pass behind it, and draws nothing', async () => {
    const memory = new HarvestMemory();
    const real = await memory.listProbes(MERCADONA, { limit: 10 });
    jest.spyOn(memory, 'listProbes').mockResolvedValue({
      items: [
        { ...real.items[0], id: 'probe-running', status: 'RUNNING' },
        ...real.items,
      ],
      nextCursor: null,
    });
    const { fixture } = await render(MERCADONA, memory);

    expect(fixture.componentInstance.verdict()).toBe(null);
    expect(host(fixture).children).toHaveLength(0);
  });

  it('draws nothing when the probes cannot be read', async () => {
    const memory = new HarvestMemory();
    jest
      .spyOn(memory, 'listProbes')
      .mockRejectedValue(new Error('the probe route did not answer'));
    const { fixture } = await render(DEZA, memory);

    expect(fixture.componentInstance.verdict()).toBe(null);
    expect(host(fixture).children).toHaveLength(0);
  });

  it('reads nothing for a record that is being added', async () => {
    const { fixture, reads } = await render('');

    expect(reads).not.toHaveBeenCalled();
    expect(host(fixture).children).toHaveLength(0);
  });
});
