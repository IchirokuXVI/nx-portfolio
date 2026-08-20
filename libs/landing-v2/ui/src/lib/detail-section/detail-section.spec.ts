import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { DetailSection } from './detail-section';

describe('DetailSection', () => {
  let fixture: ComponentFixture<DetailSection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailSection],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DetailSection);
    fixture.componentRef.setInput('sectionId', 'overview');
    fixture.componentRef.setInput('heading', 'Overview');
  });

  it('renders the heading and exposes the section id as an anchor', () => {
    fixture.componentRef.setInput('paragraphKeys', ['p.a']);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.detail-section__heading')?.textContent).toBe(
      'Overview'
    );
    expect(host.querySelector('#overview')).not.toBeNull();
  });

  it('renders one paragraph per key (the testing translator echoes the key)', () => {
    fixture.componentRef.setInput('paragraphKeys', ['p.a', 'p.b', 'p.c']);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const paragraphs = host.querySelectorAll('.detail-section__paragraph');
    expect(paragraphs.length).toBe(3);
    expect(paragraphs[0].textContent).toBe('p.a');
    expect(paragraphs[2].textContent).toBe('p.c');
  });

  it('renders no paragraphs when the key list is empty', () => {
    fixture.componentRef.setInput('paragraphKeys', []);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.detail-section__paragraph').length).toBe(0);
  });
});
