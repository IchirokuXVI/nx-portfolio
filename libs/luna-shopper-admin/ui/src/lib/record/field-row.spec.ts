import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { FieldMessage } from '@portfolio/luna-shopper-admin/models';
import { describedByOf, errorIdsOf, FieldRow, helpIdOf } from './field-row';

/** One field, label first (admin plan 0052, section 3.1). */

@Component({
  imports: [FieldRow],
  template: `
    <lib-field-row
      [changed]="changed()"
      [controlId]="controlId()"
      [help]="help()"
      [label]="'City'"
      [loading]="loading()"
      [messages]="messages()"
      [required]="required()"
    >
      <span class="content">Sevilla</span>
    </lib-field-row>
  `,
})
class Host {
  readonly controlId = signal<string | null>(null);
  readonly required = signal(false);
  readonly changed = signal(false);
  readonly help = signal<string | null>(null);
  readonly messages = signal<readonly FieldMessage[]>([]);
  readonly loading = signal(false);
}

function render(set: (host: Host) => void = () => undefined) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(Host);
  set(fixture.componentInstance);
  fixture.detectChanges();

  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('FieldRow while the page reads', () => {
  it('is a term and its description, so the two are heard as a pair', () => {
    const { host } = render();

    expect(host.querySelector('dl > dt')?.textContent?.trim()).toBe('City');
    expect(host.querySelector('dl > dd .content')?.textContent).toBe('Sevilla');
    expect(host.querySelector('label')).toBeNull();
  });

  it('draws a grey bar in place of the value while it loads, and says so', () => {
    const { host } = render((row) => row.loading.set(true));
    const bar = host.querySelector('[data-loading]');

    expect(host.querySelector('.content')).toBeNull();
    expect(bar?.getAttribute('aria-busy')).toBe('true');
    expect(bar?.textContent?.trim()).toBe('record.row.loading');
  });
});

describe('FieldRow while the page changes', () => {
  const editing = (row: Host) => row.controlId.set('field-city');

  it('ties the label to its control', () => {
    const { host } = render(editing);
    const label = host.querySelector('label');

    expect(label?.textContent?.trim()).toBe('City');
    expect(label?.getAttribute('for')).toBe('field-city');
    expect(host.querySelector('dl')).toBeNull();
    expect(host.querySelector('.value .content')?.textContent).toBe('Sevilla');
  });

  it('draws a star for a required field, and hides it from a screen reader', () => {
    const { host } = render((row) => {
      editing(row);
      row.required.set(true);
    });
    const star = host.querySelector('.star');

    expect(star?.textContent).toBe('*');
    expect(star?.getAttribute('aria-hidden')).toBe('true');
    // Outside the label, so the name of the control is the label alone.
    expect(host.querySelector('label .star')).toBeNull();
    expect(render(editing).host.querySelector('.star')).toBeNull();
  });

  it('says Changed beside the label of a field that was changed', () => {
    expect(render(editing).host.querySelector('[data-changed]')).toBeNull();
    expect(
      render((row) => {
        editing(row);
        row.changed.set(true);
      })
        .host.querySelector('[data-changed]')
        ?.textContent?.trim()
    ).toBe('record.row.changed');
  });

  it('writes each refusal as a line with a warning mark, under an id the control can name', () => {
    const { host } = render((row) => {
      editing(row);
      row.messages.set([
        { kind: 'key', key: 'resource.error.notAUrl' },
        { kind: 'text', text: 'Already taken.' },
      ]);
    });
    const lines = [...host.querySelectorAll('[data-error]')];

    expect(lines.map((line) => line.textContent?.trim())).toEqual([
      'resource.error.notAUrl',
      'Already taken.',
    ]);
    expect(lines.map((line) => line.id)).toEqual(errorIdsOf('field-city', 2));
    expect(
      lines.every((line) => line.querySelector('lib-warning-icon') !== null)
    ).toBe(true);
  });

  it('writes the help under the control, under an id the control can name', () => {
    const { host } = render((row) => {
      editing(row);
      row.help.set('shops.city.help');
    });
    const help = host.querySelector('[data-help]');

    expect(help?.textContent?.trim()).toBe('shops.city.help');
    expect(help?.id).toBe(helpIdOf('field-city'));
  });
});

describe('the ids a control is described by', () => {
  it('numbers the refusals of a control from nothing', () => {
    expect(errorIdsOf('field-city', 0)).toEqual([]);
    expect(errorIdsOf('field-city', 2)).toEqual([
      'field-city-error-0',
      'field-city-error-1',
    ]);
  });

  it('names the refusals first and the help after them', () => {
    expect(describedByOf('field-city', 2, true)).toBe(
      'field-city-error-0 field-city-error-1 field-city-help'
    );
    expect(describedByOf('field-city', 0, true)).toBe('field-city-help');
    expect(describedByOf('field-city', 1, false)).toBe('field-city-error-0');
  });

  /** `null` leaves the attribute off. An empty one names nothing. */
  it('answers nothing for a control with neither', () => {
    expect(describedByOf('field-city', 0, false)).toBeNull();
  });
});
