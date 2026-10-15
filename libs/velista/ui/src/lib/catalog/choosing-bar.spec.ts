import { TestBed } from '@angular/core/testing';
import { ChoosingBar } from './choosing-bar';

async function render(inputs: { forDetail?: string; disabled?: boolean }) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ChoosingBar],
  }).compileComponents();
  const fixture = TestBed.createComponent(ChoosingBar);
  fixture.componentRef.setInput('forLabel', 'For Cocina');
  fixture.componentRef.setInput('forDetail', inputs.forDetail ?? '');
  fixture.componentRef.setInput('action', 'Use this product');
  fixture.componentRef.setInput('disabled', inputs.disabled ?? false);
  fixture.detectChanges();
  return fixture;
}

describe('ChoosingBar (velista 0140)', () => {
  it('names what the product is for in two lines, and the one button', async () => {
    const fixture = await render({ forDetail: 'Leche para el café' });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.for-label')?.textContent).toBe('For Cocina');
    expect(host.querySelector('.for-detail')?.textContent).toBe(
      'Leche para el café'
    );
    expect(host.querySelector('button')?.textContent?.trim()).toBe(
      'Use this product'
    );
  });

  it('draws one line when there is no detail', async () => {
    const fixture = await render({});

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.for-detail')
    ).toBeNull();
  });

  it('says the button was pressed, also while it is drawn unavailable (velista 0146)', async () => {
    const used: void[] = [];
    const fixture = await render({ disabled: true });
    fixture.componentInstance.used.subscribe(() => used.push(undefined));
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button'
    ) as HTMLButtonElement;

    // Unavailable, and still in the tab order: the page says why on a press.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    expect(used).toHaveLength(1);

    fixture.componentRef.setInput('disabled', false);
    fixture.detectChanges();
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    button.click();
    expect(used).toHaveLength(2);
  });
});
