import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BackStack, provideVelistaTesting } from '@portfolio/velista/platform';
import { AuthScreen } from './auth-screen';

@Component({
  imports: [AuthScreen],
  template: `
    @if (shown()) {
      <lib-auth-screen
        (back)="backs = backs + 1"
        backLabel="Back"
        lede="Lede"
        title="Sign in"
      />
    }
  `,
})
class Host {
  readonly shown = signal(true);
  backs = 0;
}

/**
 * Velista `0166`. The credential screens have no page header, so the frame answers a
 * native back press itself, with the same output its chevron emits.
 */
describe('AuthScreen and a native back press', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideVelistaTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('emits back, as the chevron does', async () => {
    const fixture = await render();

    expect(TestBed.inject(BackStack).handle()).toBe(true);
    expect(fixture.componentInstance.backs).toBe(1);
  });

  it('leaves the stack when the screen is gone', async () => {
    const fixture = await render();
    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(TestBed.inject(BackStack).handle()).toBe(false);
    expect(fixture.componentInstance.backs).toBe(0);
  });
});
