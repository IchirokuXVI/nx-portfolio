// jsdom has no ResizeObserver, and `MainHeader` builds one in a field initializer.
// It only started mattering here once the translations moved to the app injector:
// the wrapper gates its chrome on `compReady`, the shared testing translator reports
// ready synchronously, and so the header now actually renders in this spec.
global.ResizeObserver = require('resize-observer-polyfill');

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { DamoclesSwordWrapper } from './damocles-sword-wrapper';

describe('DamoclesSwordWrapper', () => {
  let component: DamoclesSwordWrapper;
  let fixture: ComponentFixture<DamoclesSwordWrapper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordWrapper],
      providers: [provideRouter([]), provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordWrapper);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
