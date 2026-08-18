import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LanguageSelector } from './language-selector';

describe('LanguageSelector', () => {
  let component: LanguageSelector;
  let fixture: ComponentFixture<LanguageSelector>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageSelector],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSelector);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('languages', ['en', 'es']);
    fixture.componentRef.setInput('selectedLanguage', 'en');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('closes the open dropdown when a click lands outside it', () => {
    component.showLanguageOptions.set(true);

    // A click on an element that is not part of the selector closes it.
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    component.onDocumentClick(outside);

    expect(component.showLanguageOptions()).toBe(false);
    outside.remove();
  });

  it('closes the open dropdown on a real document click outside (host binding)', () => {
    // Attach to the document so a dispatched click bubbles up to the
    // `(document:click)` host listener that wires up onDocumentClick.
    document.body.appendChild(fixture.nativeElement);
    component.showLanguageOptions.set(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(component.showLanguageOptions()).toBe(false);
    fixture.nativeElement.remove();
  });

  it('document click keeps the dropdown open when the click lands on the component', () => {
    component.showLanguageOptions.set(true);

    const inside: HTMLElement = fixture.nativeElement.querySelector(
      '.selected-language-container'
    );
    expect(inside).toBeTruthy();
    component.onDocumentClick(inside);

    expect(component.showLanguageOptions()).toBe(true);
  });

  it('document click does nothing when the dropdown is already closed', () => {
    component.showLanguageOptions.set(false);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    component.onDocumentClick(outside);

    expect(component.showLanguageOptions()).toBe(false);
    outside.remove();
  });

  it('closes the dropdown when changing language', async () => {
    component.showLanguageOptions.set(true);

    const unselectedLanguageOption: HTMLElement =
      fixture.nativeElement.querySelector(
        '.selectable-languages .language-label:not(.selected-language)'
      );
    expect(unselectedLanguageOption).toBeTruthy();
    unselectedLanguageOption.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    expect(component.showLanguageOptions()).toBe(false);
  });
});
