import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionPublishing } from './section-publishing';

describe('SectionPublishing', () => {
  let component: SectionPublishing;
  let fixture: ComponentFixture<SectionPublishing>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionPublishing],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionPublishing);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
