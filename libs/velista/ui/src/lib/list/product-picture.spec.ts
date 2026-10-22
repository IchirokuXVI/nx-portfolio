import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ProductPicture } from './product-picture';

/**
 * The picture of a row, and the photo it opens large on a press. The viewer is a
 * native `dialog`, which jsdom draws only by its `open` attribute, so these check
 * what is in the DOM and leave the top layer to a browser.
 */
async function render(inputs: {
  imageUrl: string | null;
  zoom?: string | null;
}): Promise<ComponentFixture<ProductPicture>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ProductPicture, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProductPicture);
  fixture.componentRef.setInput('imageUrl', inputs.imageUrl);
  if (inputs.zoom !== undefined) {
    fixture.componentRef.setInput('zoom', inputs.zoom);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<ProductPicture>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function query<T extends Element = HTMLElement>(
  fixture: ComponentFixture<ProductPicture>,
  selector: string
): T | null {
  return host(fixture).querySelector<T>(selector);
}

async function settle(
  fixture: ComponentFixture<ProductPicture>
): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const PHOTO = 'https://img.example/milk.jpg';

describe('ProductPicture', () => {
  it('is decoration with no name: hidden, and nothing to press', async () => {
    const fixture = await render({ imageUrl: PHOTO });

    expect(host(fixture).getAttribute('aria-hidden')).toBe('true');
    expect(query(fixture, 'button')).toBeNull();
    expect(query(fixture, 'img')).not.toBeNull();
  });

  it('is a button named for the product with a name and a photo', async () => {
    const fixture = await render({ imageUrl: PHOTO, zoom: 'Leche' });

    expect(host(fixture).getAttribute('aria-hidden')).toBeNull();
    const button = query(fixture, 'button.zoom');
    expect(button?.getAttribute('aria-label')).toBe('photo.open');
    expect(button?.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
    expect(query(fixture, 'dialog')).toBeNull();
  });

  it('stays decoration with a name and no photo, because nothing is bigger', async () => {
    const fixture = await render({ imageUrl: null, zoom: 'Leche' });

    expect(host(fixture).getAttribute('aria-hidden')).toBe('true');
    expect(query(fixture, 'button')).toBeNull();
    expect(query(fixture, 'lib-product-icon')).not.toBeNull();
  });

  it('stops being a button when the photo does not load', async () => {
    const fixture = await render({ imageUrl: PHOTO, zoom: 'Leche' });

    query(fixture, 'img')?.dispatchEvent(new Event('error'));
    await settle(fixture);

    expect(query(fixture, 'button')).toBeNull();
    expect(query(fixture, 'lib-product-icon')).not.toBeNull();
  });

  it('opens the photo large, named for the product, on a press', async () => {
    const fixture = await render({ imageUrl: PHOTO, zoom: 'Leche' });

    query(fixture, 'button.zoom')?.click();
    await settle(fixture);

    const dialog = query<HTMLDialogElement>(fixture, 'dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('aria-label')).toBe('Leche');
    const photo = dialog?.querySelector('img');
    expect(photo?.getAttribute('src')).toBe(PHOTO);
    expect(photo?.getAttribute('alt')).toBe('Leche');
    expect(dialog?.querySelector('figcaption')?.textContent?.trim()).toBe(
      'Leche'
    );
    expect(
      dialog?.querySelector('button.close')?.getAttribute('aria-label')
    ).toBe('photo.close');
  });

  it('keeps the press from the row under it', async () => {
    const fixture = await render({ imageUrl: PHOTO, zoom: 'Leche' });
    const heard: string[] = [];
    for (const type of ['click', 'keydown', 'pointerdown']) {
      host(fixture).addEventListener(type, () => heard.push(type));
    }

    const button = query(fixture, 'button.zoom');
    button?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    button?.click();
    await settle(fixture);

    const dialog = query(fixture, 'dialog');
    dialog?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })
    );

    expect(heard).toEqual([]);
  });

  it.each([
    ['the cross', 'dialog button.close'],
    ['the photo', 'dialog img.photo'],
    ['the dimmed screen', 'dialog'],
  ])('closes on a press on %s', async (_what, selector) => {
    const fixture = await render({ imageUrl: PHOTO, zoom: 'Leche' });
    query(fixture, 'button.zoom')?.click();
    await settle(fixture);

    query(fixture, selector)?.click();
    await settle(fixture);

    expect(query(fixture, 'dialog')).toBeNull();
  });

  it('removes the viewer when the browser closes the dialog itself', async () => {
    const fixture = await render({ imageUrl: PHOTO, zoom: 'Leche' });
    query(fixture, 'button.zoom')?.click();
    await settle(fixture);

    // Escape and the back gesture close a modal dialog with no click.
    query(fixture, 'dialog')?.dispatchEvent(new Event('close'));
    await settle(fixture);

    expect(query(fixture, 'dialog')).toBeNull();
  });
});
