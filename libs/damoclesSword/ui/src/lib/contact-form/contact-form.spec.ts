import {
  ComponentFixture,
  fakeAsync,
  TestBed,
  tick,
} from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { ContactForm } from './contact-form';

describe('ContactForm', () => {
  let component: ContactForm;
  let fixture: ComponentFixture<ContactForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactForm],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactForm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not send while the form is invalid', () => {
    component.submit();
    expect(component.sent()).toBe(false);
  });

  it('should send once required fields are filled', fakeAsync(() => {
    component.form.setValue({
      email: 'a@b.com',
      name: '',
      affair: '',
      message: 'Hello',
      links: '',
    });
    component.submit();
    tick(600);
    expect(component.sent()).toBe(true);
  }));
});
