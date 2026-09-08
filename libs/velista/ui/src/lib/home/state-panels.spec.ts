import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { UpdateScreen } from './state-panels';

/**
 * A host, because the panel takes six inputs and the spec is about how they combine
 * into two faces rather than about any one of them.
 */
@Component({
  imports: [UpdateScreen],
  template: `
    <lib-update-screen
      (reload)="reloads = reloads + 1"
      [body]="'The new one is on its way.'"
      [failedBody]="'Close velista and open it again.'"
      [failedTitle]="'velista could not update itself'"
      [reloadLabel]="'Try again'"
      [spent]="spent()"
      [title]="'velista is updating'"
    />
  `,
})
class UpdateScreenHost {
  readonly spent = signal(false);
  reloads = 0;
}

describe('UpdateScreen', () => {
  async function createFixture(): Promise<ComponentFixture<UpdateScreenHost>> {
    await TestBed.configureTestingModule({
      imports: [UpdateScreenHost],
      providers: [provideVelistaTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(UpdateScreenHost);
    fixture.detectChanges();
    return fixture;
  }

  function textOf(fixture: ComponentFixture<UpdateScreenHost>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttonOf(
    fixture: ComponentFixture<UpdateScreenHost>
  ): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('button');
  }

  /**
   * The updating face says what is happening rather than apologising for it, and it
   * asks the user for nothing, because there is nothing for them to do yet.
   */
  it('says the app is updating, with nothing to press', async () => {
    const fixture = await createFixture();

    expect(textOf(fixture)).toContain('velista is updating');
    expect(textOf(fixture)).toContain('The new one is on its way.');
    expect(buttonOf(fixture)).toBeNull();
  });

  it('turns into the dead end when the attempt is spent', async () => {
    const fixture = await createFixture();

    fixture.componentInstance.spent.set(true);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('velista could not update itself');
    expect(textOf(fixture)).toContain('Close velista and open it again.');
    expect(textOf(fixture)).not.toContain('velista is updating');
  });

  it('offers one reload, and only from the dead end', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.spent.set(true);
    fixture.detectChanges();

    const button = buttonOf(fixture);
    expect(button?.textContent?.trim()).toBe('Try again');

    button?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.reloads).toBe(1);
  });

  /**
   * Both faces live in one polite live region, so the change from one to the other is
   * announced without interrupting and moves no focus. Being the only content on the
   * screen, nothing behind it is reachable by tab, so it needs no focus trap.
   */
  it('announces both faces from one polite region', async () => {
    const fixture = await createFixture();
    const host: HTMLElement = fixture.nativeElement;

    const region = host.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');

    fixture.componentInstance.spent.set(true);
    fixture.detectChanges();

    expect(host.querySelectorAll('[role="status"]').length).toBe(1);
  });
});
