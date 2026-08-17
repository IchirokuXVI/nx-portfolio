import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { refetchOnLocaleChange } from './refetch-on-locale-change';
import { RokuLocaleStore } from './roku-locale-store';

describe('RokuLocaleStore', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('updates its locale signal when the core emits a change', async () => {
    const store = TestBed.inject(RokuLocaleStore);

    await RokuTranslator.changeLocale('es');
    expect(store.getLocale()).toBe('es');
    expect(store.locale()).toBe('es');

    await RokuTranslator.changeLocale('en');
    expect(store.locale()).toBe('en');
  });
});

describe('refetchOnLocaleChange', () => {
  it('throws when built outside an injection context (no service passed)', () => {
    // inject() has nothing to resolve against here, so the fail-fast is automatic.
    expect(() => refetchOnLocaleChange()).toThrow();
  });
});
