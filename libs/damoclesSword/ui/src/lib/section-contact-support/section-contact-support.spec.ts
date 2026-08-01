import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionContactSupport } from './section-contact-support';

describe('SectionContactSupport', () => {
  let component: SectionContactSupport;
  let fixture: ComponentFixture<SectionContactSupport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionContactSupport],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionContactSupport);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not confirm a subscription for an empty email', () => {
    component.email.set('   ');
    component.subscribe();

    expect(component.subscribed()).toBe(false);
  });

  it('confirms the subscription and clears the email on submit', () => {
    component.email.set('player@example.com');
    component.subscribe();

    expect(component.subscribed()).toBe(true);
    expect(component.email()).toBe('');
  });
});
