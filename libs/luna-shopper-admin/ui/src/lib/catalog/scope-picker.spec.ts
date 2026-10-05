import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { PopoverSheet } from '../page/popover-sheet';
import { ScopeMark } from '../page/scope-mark';
import { Viewport } from '../viewport';
import {
  ScopePicker,
  type ScopePickerChain,
  type ScopePickerScope,
} from './scope-picker';

/**
 * The picker of one price scope: a chain, then one of its scopes (admin plan
 * 0043, target 2). Presentational: it reads nothing, and says what was opened
 * and what was chosen.
 */

const CHAINS: readonly ScopePickerChain[] = [
  { id: 'mercadona', name: 'Mercadona' },
  { id: 'dia', name: 'DIA' },
];

const SCOPES: readonly ScopePickerScope[] = [
  { id: 'national', name: 'Nationwide', level: 1, kind: 'Nationwide' },
  { id: 'south', name: 'South region', level: 2, kind: 'Chain region' },
];

interface Events {
  opened: number;
  chains: (string | null)[];
  scopes: (string | null)[];
  shops: number;
}

async function render(inputs: Record<string, unknown> = {}, compact = false) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ScopePicker, RokuTranslatorTestingModule.forTesting()],
    providers: [
      {
        provide: Viewport,
        useValue: { compact: signal(compact), split: signal(!compact) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ScopePicker);
  fixture.componentRef.setInput('label', 'Choose the price scope');
  fixture.componentRef.setInput('chains', CHAINS);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }

  const events: Events = { opened: 0, chains: [], scopes: [], shops: 0 };
  const picker = fixture.componentInstance;
  picker.opened.subscribe(() => (events.opened += 1));
  picker.chainChange.subscribe((id) => events.chains.push(id));
  picker.scopeChange.subscribe((id) => events.scopes.push(id));
  picker.shopsWanted.subscribe(() => (events.shops += 1));

  fixture.detectChanges();
  return { fixture, events };
}

const trigger = (fixture: ComponentFixture<ScopePicker>) =>
  fixture.nativeElement.querySelector(
    '[data-scope-picker]'
  ) as HTMLButtonElement;

async function open(fixture: ComponentFixture<ScopePicker>) {
  trigger(fixture).click();
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
}

afterEach(() => TestBed.resetTestingModule());

describe('ScopePicker', () => {
  it('says what it is for on a button, and what to do while nothing is chosen', async () => {
    const { fixture } = await render({
      prefix: 'Prices at',
      placeholder: 'No scope',
    });

    expect(trigger(fixture).getAttribute('aria-label')).toBe(
      'Choose the price scope'
    );
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(trigger(fixture).textContent).toContain('Prices at');
    expect(trigger(fixture).textContent).toContain('No scope');
  });

  /** "Nationwide" alone is the name of a scope of every chain. */
  it('writes the chosen scope with its chain before it, and its mark', async () => {
    const { fixture } = await render({
      value: 'national',
      choice: {
        chain: 'Mercadona',
        scope: 'Nationwide',
        level: 1,
        kind: 'Nationwide',
      },
    });

    expect(trigger(fixture).textContent).toContain('Mercadona, Nationwide');
    const mark = fixture.debugElement.query(By.directive(ScopeMark))
      .componentInstance as ScopeMark;
    expect(mark.level()).toBe(1);
    // The mark says the kind, since the button does not write it.
    expect(mark.label()).toBe('Nationwide');
  });

  it('opens on the chains, and says that it opened', async () => {
    const { fixture, events } = await render();

    await open(fixture);

    expect(events.opened).toBe(1);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    const chains = [
      ...fixture.nativeElement.querySelectorAll('[data-chain]'),
    ].map((node) => (node as HTMLElement).textContent?.trim());
    expect(chains).toEqual(['Mercadona', 'DIA']);
  });

  it('says it is reading while the chains have not arrived', async () => {
    const { fixture } = await render({ chains: null });

    await open(fixture);

    expect(fixture.nativeElement.querySelector('[data-chain]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[role="status"]')?.textContent
    ).toContain('resource.list.loading');
  });

  it('says which chain was opened, and reads nothing itself', async () => {
    const { fixture, events } = await render();
    await open(fixture);

    (
      fixture.nativeElement.querySelector(
        '[data-chain="dia"]'
      ) as HTMLButtonElement
    ).click();

    expect(events.chains).toEqual(['dia']);
    // Still the chains: whoever holds it hands it the chain and its scopes.
    expect(events.scopes).toEqual([]);
  });

  it('lists the scopes of the open chain, each with its mark and kind', async () => {
    const { fixture } = await render({ chainId: 'mercadona', scopes: SCOPES });
    await open(fixture);

    const rows = [
      ...fixture.nativeElement.querySelectorAll('[data-scope]'),
    ] as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('data-scope'))).toEqual([
      'national',
      'south',
    ]);
    expect(rows[1].textContent).toContain('South region');
    expect(rows[1].textContent).toContain('Chain region');
    expect(
      fixture.debugElement
        .queryAll(By.directive(ScopeMark))
        .map((mark) => (mark.componentInstance as ScopeMark).level())
    ).toEqual([1, 2]);
    // The chain, as the way back to the chains.
    expect(
      fixture.nativeElement.querySelector('.row.back')?.textContent
    ).toContain('Mercadona');
  });

  it('chooses a scope, says so, and closes', async () => {
    const { fixture, events } = await render({
      chainId: 'mercadona',
      scopes: SCOPES,
    });
    await open(fixture);

    (
      fixture.nativeElement.querySelector(
        '[data-scope="south"]'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(events.scopes).toEqual(['south']);
    expect(fixture.componentInstance.open()).toBe(false);
    expect(fixture.debugElement.query(By.directive(PopoverSheet))).toBeNull();
  });

  it('goes back to the chains', async () => {
    const { fixture, events } = await render({
      chainId: 'mercadona',
      scopes: SCOPES,
    });
    await open(fixture);

    (
      fixture.nativeElement.querySelector('.row.back') as HTMLButtonElement
    ).click();

    expect(events.chains).toEqual([null]);
  });

  it('marks the chosen scope among the others', async () => {
    const { fixture } = await render({
      chainId: 'mercadona',
      scopes: SCOPES,
      value: 'south',
    });
    await open(fixture);

    expect(
      fixture.nativeElement
        .querySelector('[data-scope="south"]')
        ?.getAttribute('aria-current')
    ).toBe('true');
    expect(
      fixture.nativeElement
        .querySelector('[data-scope="national"]')
        ?.getAttribute('aria-current')
    ).toBeNull();
  });

  /** A chain's single shop scopes are one for every shop. */
  it('asks for the single shop scopes only when the operator does', async () => {
    const { fixture, events } = await render({
      chainId: 'mercadona',
      scopes: SCOPES,
      shopsOffered: true,
    });
    await open(fixture);

    expect(events.shops).toBe(0);
    (
      fixture.nativeElement.querySelector(
        '[data-shop-scopes]'
      ) as HTMLButtonElement
    ).click();
    expect(events.shops).toBe(1);
  });

  it('says so when the list of scopes is not whole', async () => {
    const { fixture } = await render({
      chainId: 'mercadona',
      scopes: SCOPES,
      truncated: true,
    });
    await open(fixture);

    expect(fixture.nativeElement.textContent).toContain(
      'catalog.scopePicker.truncated'
    );
  });

  it('offers a field to find a scope once the list is long', async () => {
    const many: ScopePickerScope[] = Array.from({ length: 12 }, (_, index) => ({
      id: `area-${index}`,
      name: index === 7 ? 'Córdoba warehouse' : `Area ${index}`,
      level: 3,
      kind: 'Local area',
    }));
    const { fixture } = await render({ chainId: 'mercadona', scopes: many });
    await open(fixture);

    expect(
      fixture.nativeElement.querySelector('input[type="search"]')
    ).not.toBeNull();

    fixture.componentInstance.term.set('córdoba');
    fixture.detectChanges();

    expect(
      [...fixture.nativeElement.querySelectorAll('[data-scope]')].map((node) =>
        (node as HTMLElement).getAttribute('data-scope')
      )
    ).toEqual(['area-7']);
  });

  it('offers no scope as a choice only where it is told to', async () => {
    const off = await render({ value: 'national' });
    await open(off.fixture);
    expect(
      off.fixture.nativeElement.querySelector('[data-scope-clear]')
    ).toBeNull();

    const on = await render({ value: 'national', clearable: true });
    await open(on.fixture);
    (
      on.fixture.nativeElement.querySelector(
        '[data-scope-clear]'
      ) as HTMLButtonElement
    ).click();
    expect(on.events.scopes).toEqual([null]);
  });

  it('is a panel under the button on a wide screen and a sheet on a phone', async () => {
    const wide = await render();
    await open(wide.fixture);
    expect(
      (
        wide.fixture.debugElement.query(By.directive(PopoverSheet))
          .componentInstance as PopoverSheet
      ).sheet()
    ).toBe(false);

    const phone = await render({}, true);
    await open(phone.fixture);
    expect(
      (
        phone.fixture.debugElement.query(By.directive(PopoverSheet))
          .componentInstance as PopoverSheet
      ).sheet()
    ).toBe(true);
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    const { fixture } = await render();
    document.body.appendChild(fixture.nativeElement);
    await open(fixture);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(false);
    expect(document.activeElement).toBe(trigger(fixture));
    fixture.nativeElement.remove();
  });
});
