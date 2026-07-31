import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionLayout } from './section-layout';

describe('SectionLayout', () => {
  let component: SectionLayout;
  let fixture: ComponentFixture<SectionLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionLayout],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not render a title block when title is not set', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.section-title')).toBeNull();
  });
});
