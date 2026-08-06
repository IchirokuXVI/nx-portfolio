import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionFuture } from './section-future';

describe('SectionFuture', () => {
  let component: SectionFuture;
  let fixture: ComponentFixture<SectionFuture>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionFuture],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionFuture);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
