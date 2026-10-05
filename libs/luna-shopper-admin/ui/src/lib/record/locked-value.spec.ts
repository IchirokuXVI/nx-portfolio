import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { LockedValue } from './locked-value';

/** A value the form shows and cannot change (admin plan 0052, section 3.8). */

@Component({
  imports: [LockedValue],
  template: `
    <lib-locked-value reason="record.locked.fixedOnAdd">
      <span class="content">Mercadona</span>
    </lib-locked-value>
  `,
})
class Host {}

describe('LockedValue', () => {
  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host, RokuTranslatorTestingModule.forTesting()],
    });

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).querySelector(
      'lib-locked-value'
    ) as HTMLElement;
  }

  it('draws the value, then the lock, then who set it', () => {
    const host = render();

    expect(host.firstElementChild?.className).toBe('content');
    expect(host.querySelector('lib-lock-icon')).not.toBeNull();
    expect(host.querySelector('[data-reason]')?.textContent?.trim()).toBe(
      'record.locked.fixedOnAdd'
    );
  });

  /** The words carry the meaning. The lock is for the eye. */
  it('holds no control, so nothing in it can be changed', () => {
    expect(
      render().querySelector('input, select, textarea, button')
    ).toBeNull();
  });
});
