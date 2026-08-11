import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { InfoFactMemory } from './info-facts-memory';
import { INFO_FACTS } from './static-info-facts-data';

describe('InfoFactMemory', () => {
  let service: InfoFactMemory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(InfoFactMemory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('returns every fact ordered ascending', async () => {
    const facts = await firstValueFrom(service.getList('en'));

    expect(facts).toHaveLength(INFO_FACTS.length);
    expect(facts.map((f) => f.order)).toEqual([1, 2, 3, 4]);
  });

  it('joins the requested locale copy', async () => {
    const facts = await firstValueFrom(service.getList('es'));
    const based = facts.find((f) => f.factId === '4');

    expect(based?.locale).toBe('es');
    expect(based?.label).toBe('UBICACIÓN');
    expect(based?.value).toBe('España');
    expect(based?.note).toBe('En remoto');
  });

  it('falls back to the English copy for an unknown locale', async () => {
    const facts = await firstValueFrom(service.getList('de'));
    const focus = facts.find((f) => f.factId === '1');

    expect(focus?.locale).toBe('en');
    expect(focus?.label).toBe('FOCUS');
  });
});
