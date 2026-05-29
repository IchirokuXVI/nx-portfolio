import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { MainHeader } from './main-header';

describe('MainHeader', () => {
  let component: MainHeader;
  let fixture: ComponentFixture<MainHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainHeader, RouterModule.forRoot([])],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MainHeader);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
