import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RecordSection } from './record-section';

/** A panel with one heading (admin plan 0052, section 3.1). */

@Component({
  imports: [RecordSection],
  template: `
    <lib-record-section
      [count]="count()"
      [heading]="'Sold as'"
      [level]="level()"
    >
      <button sectionAction type="button">Link a spelling</button>
      <p class="row">A row</p>
    </lib-record-section>
  `,
})
class Host {
  readonly count = signal<number | null>(null);
  readonly level = signal<2 | 3>(2);
}

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Host] });

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();

  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('RecordSection', () => {
  it('draws the heading at the second level, and names the panel by it', () => {
    const { host } = render();
    const heading = host.querySelector('h2');

    expect(heading?.textContent?.trim()).toBe('Sold as');
    expect(host.querySelector('h3')).toBeNull();
    expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
      heading?.id
    );
  });

  it('draws the heading one level down inside a pane', () => {
    const { fixture, host } = render();

    fixture.componentInstance.level.set(3);
    fixture.detectChanges();

    expect(host.querySelector('h3')?.textContent?.trim()).toBe('Sold as');
    expect(host.querySelector('h2')).toBeNull();
  });

  it('draws a count beside the heading only when it is given one', () => {
    const { fixture, host } = render();

    expect(host.querySelector('[data-count]')).toBeNull();

    fixture.componentInstance.count.set(3);
    fixture.detectChanges();
    expect(host.querySelector('[data-count]')?.textContent?.trim()).toBe('3');

    // Nothing is a count too, and it is not the same as no count.
    fixture.componentInstance.count.set(0);
    fixture.detectChanges();
    expect(host.querySelector('[data-count]')?.textContent?.trim()).toBe('0');
  });

  it('puts the action in the heading row and the rows under it', () => {
    const { host } = render();

    expect(host.querySelector('.head button')?.textContent?.trim()).toBe(
      'Link a spelling'
    );
    expect(host.querySelector('.head .row')).toBeNull();
    expect(host.querySelector('section > .row')?.textContent).toBe('A row');
  });

  it('gives two sections two heading ids', () => {
    const first = render().host.querySelector('h2')?.id;
    const second = render().host.querySelector('h2')?.id;

    expect(first).not.toBe(second);
  });
});
