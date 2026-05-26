import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DamoclesSwordWrapper } from './damoclesSword-wrapper';

jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
      addNamespace: jest.fn(),
      addTranslations: jest.fn(),
      removeNamespace: jest.fn(),
    },
  };
});

describe('DamoclesSwordWrapper', () => {
  let component: DamoclesSwordWrapper;
  let fixture: ComponentFixture<DamoclesSwordWrapper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordWrapper],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordWrapper);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
