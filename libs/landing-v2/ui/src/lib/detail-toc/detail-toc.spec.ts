import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { DetailToc } from './detail-toc';

describe('DetailToc', () => {
  let fixture: ComponentFixture<DetailToc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailToc],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DetailToc);
  });

  it('renders one anchor per item, linking to the section id', () => {
    fixture.componentRef.setInput('items', [
      { id: 'overview', labelKey: 'toc.overview' },
      { id: 'engineering', labelKey: 'toc.engineering' },
    ]);
    fixture.detectChanges();

    const links = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
      '.detail-toc__link'
    );

    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('#overview');
    // The testing translator echoes the key back, so the label is the key.
    expect(links[0].textContent?.trim()).toBe('toc.overview');
  });

  it('marks the active item once activeId is set', () => {
    fixture.componentRef.setInput('items', [
      { id: 'overview', labelKey: 'toc.overview' },
      { id: 'engineering', labelKey: 'toc.engineering' },
    ]);
    fixture.componentInstance.activeId.set('engineering');
    fixture.detectChanges();

    const active = (fixture.nativeElement as HTMLElement).querySelector(
      '.detail-toc__link--active'
    );
    expect(active?.getAttribute('aria-current')).toBe('true');
    expect(active?.textContent?.trim()).toBe('toc.engineering');
  });
});
