import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { PhotoViewer } from './photo-viewer';

describe('PhotoViewer', () => {
  it('asks the chain for the photo with no referrer (velista 0172, D5)', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PhotoViewer, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(PhotoViewer);
    fixture.componentRef.setInput('src', 'https://img.example/milk.jpg');
    fixture.componentRef.setInput('name', 'Leche');
    fixture.detectChanges();
    await fixture.whenStable();

    const photo = (fixture.nativeElement as HTMLElement).querySelector('img');
    expect(photo?.getAttribute('src')).toBe('https://img.example/milk.jpg');
    expect(photo?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
