import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { RecordId } from './record-id';

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
    // The button is named for what it copies, not only "Copy".
    expect(button.getAttribute('aria-label')).toBe('resource.id.copy');
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
