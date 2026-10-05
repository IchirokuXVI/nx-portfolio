import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { ChainSelect } from './chain-select';

/**
 * A chain, chosen from a short list (admin plan 0044): the filter the four
 * queues of Review share, and the chain whose presets the Runs tab lists.
 */

const LISTED = [
  { id: 'sm_mercadona', title: 'Mercadona' },
  { id: 'sm_deza', title: 'Deza' },
];

/** A chain the first page of the directory does not hold. */
const FAR = { id: 'sm_far', title: 'Far Away Foods' };

@Component({
  selector: 'lib-test-host',
  imports: [ChainSelect],
  template: `
    <lib-chain-select
      (valueChange)="chosen.push($event)"
      [value]="value()"
      controlId="test-chain"
      label="test.chain"
      noneKey="test.anyChain"
    />
  `,
})
class Host {
  readonly value = signal('');
  readonly chosen: string[] = [];
}

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

interface World {
  readonly searchFails?: boolean;
}

async function render(value = '', world: World = {}) {
  const asked = { search: [] as unknown[], resolve: [] as string[] };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
    providers: [
      {
        provide: ResourceReferences,
        useValue: {
          search: async (resource: string, term: string) => {
            asked.search.push([resource, term]);
            if (world.searchFails === true) {
              throw new Error('the directory did not answer');
            }
            return LISTED;
          },
          resolve: async (_resource: string, id: string) => {
            asked.resolve.push(id);
            return id === FAR.id ? FAR : null;
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.value.set(value);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture: fixture as ComponentFixture<Host>, asked };
}

const select = (fixture: ComponentFixture<Host>): HTMLSelectElement =>
  fixture.nativeElement.querySelector('select');

const options = (fixture: ComponentFixture<Host>) =>
  [...select(fixture).querySelectorAll('option')].map((option) => ({
    value: option.value,
    text: option.textContent?.trim(),
  }));

describe('ChainSelect', () => {
  it('offers no chain first, then the chains the directory lists', async () => {
    const { fixture, asked } = await render();

    expect(options(fixture)).toEqual([
      { value: '', text: 'test.anyChain' },
      { value: 'sm_mercadona', text: 'Mercadona' },
      { value: 'sm_deza', text: 'Deza' },
    ]);
    // Read once, with no term: the first page of the chains.
    expect(asked.search).toEqual([['supermarkets', '']]);
  });

  it('is a labelled control with the id its page points at', async () => {
    const { fixture } = await render();

    expect(select(fixture).id).toBe('test-chain');
    expect(select(fixture).getAttribute('aria-label')).toBe('test.chain');
  });

  it('says a chosen chain by its id', async () => {
    const { fixture } = await render();

    select(fixture).value = 'sm_deza';
    select(fixture).dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.chosen).toEqual(['sm_deza']);
  });

  it('says no chain with an empty id', async () => {
    const { fixture } = await render('sm_deza');

    select(fixture).value = '';
    select(fixture).dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.chosen).toEqual(['']);
  });

  it('marks the chain that is chosen, and lists it once', async () => {
    const { fixture } = await render('sm_deza');

    const marked = [...select(fixture).querySelectorAll('option')].filter(
      (option) => option.selected
    );
    expect(marked.map((option) => option.value)).toEqual(['sm_deza']);
    expect(options(fixture)).toHaveLength(3);
  });

  /**
   * A link can name any chain. One the first page does not hold is read by
   * itself, so the control never shows a chosen chain as nothing.
   */
  it('reads a chosen chain the list does not hold, and adds it', async () => {
    const { fixture, asked } = await render(FAR.id);
    // The list answers first, and only then is the chain known to be missing
    // from it. So the read of the one chain is a second round.
    await drain();
    fixture.detectChanges();

    expect(asked.resolve).toContain(FAR.id);
    expect(options(fixture).at(-1)).toEqual({
      value: FAR.id,
      text: 'Far Away Foods',
    });
    expect(options(fixture)).toHaveLength(4);
  });

  it('adds nothing for a chain nobody knows', async () => {
    const { fixture } = await render('sm_gone');

    expect(options(fixture)).toHaveLength(3);
  });

  it('follows the chain as its page changes it', async () => {
    const { fixture } = await render();

    fixture.componentInstance.value.set(FAR.id);
    fixture.detectChanges();
    await drain();
    fixture.detectChanges();

    expect(options(fixture).map((option) => option.value)).toContain(FAR.id);
  });

  /** The control then offers no chain, and the queues stay whole. */
  it('offers only no chain when the directory does not answer', async () => {
    const { fixture } = await render('', { searchFails: true });

    expect(options(fixture)).toEqual([{ value: '', text: 'test.anyChain' }]);
  });
});
