import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { COPIED_FOR_MS, RecordId } from './record-id';

/** A record's ID, small and copyable (admin plan 0051, section 4). */
const ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';

async function render() {
  await TestBed.configureTestingModule({
    imports: [RecordId, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  const fixture = TestBed.createComponent(RecordId);
  fixture.componentRef.setInput('value', ID);
  fixture.detectChanges();
  return fixture;
}

describe('RecordId', () => {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (clipboard === undefined) {
      delete (navigator as { clipboard?: unknown }).clipboard;
    } else {
      Object.defineProperty(navigator, 'clipboard', clipboard);
    }
  });

  it('draws the whole ID, with none of it cut', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('code').textContent).toBe(ID);
  });

  it('copies the ID and says so', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    const fixture = await render();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('[data-copy-id]');

    button.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(written).toEqual([ID]);
    expect(button.textContent?.trim()).toBe('info.copied');
    expect(
      fixture.nativeElement.querySelector('[aria-live]').textContent.trim()
    ).toBe('info.copied');
  });

  /**
   * The name a screen reader says holds the word on the button. "Copy the ID"
   * holds "Copy". Nothing but "Copied" may name a button that reads "Copied".
   */
  it('is named for what it copies, and by its own word once it copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    const fixture = await render();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('[data-copy-id]');

    expect(button.getAttribute('aria-label')).toBe('resource.id.copy');

    button.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(button.textContent?.trim()).toBe('info.copied');
    expect(button.hasAttribute('aria-label')).toBe(false);
  });

  it('offers the copy again after a moment', async () => {
    jest.useFakeTimers();
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => undefined },
      });
      const fixture = await render();
      const button: HTMLButtonElement =
        fixture.nativeElement.querySelector('[data-copy-id]');
      const live: HTMLElement =
        fixture.nativeElement.querySelector('[aria-live]');

      button.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      jest.advanceTimersByTime(COPIED_FOR_MS - 1);
      fixture.detectChanges();
      expect(button.textContent?.trim()).toBe('info.copied');

      jest.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(button.textContent?.trim()).toBe('info.copy');
      expect(button.getAttribute('aria-label')).toBe('resource.id.copy');
      // Emptied, so the next copy is a change and is read out again.
      expect(live.textContent?.trim()).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the button as it was when the browser refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    const fixture = await render();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('[data-copy-id]');

    button.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(button.textContent?.trim()).toBe('info.copy');
  });
});
