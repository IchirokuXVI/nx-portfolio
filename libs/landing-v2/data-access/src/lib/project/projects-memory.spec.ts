import { TestBed } from '@angular/core/testing';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { firstValueFrom } from 'rxjs';
import { ProjectMemory } from './projects-memory';
import { PROJECTS } from './static-projects-data';

describe('ProjectMemory', () => {
  let service: ProjectMemory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectMemory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('returns every project, each carrying its visual config', async () => {
    const projects = await firstValueFrom(service.getList('en'));

    expect(projects).toHaveLength(PROJECTS.length);
    expect(projects).toHaveLength(4);
    projects.forEach((project) => {
      expect(project.visual).toEqual(
        expect.objectContaining({
          columnSpan: expect.any(Number),
          featured: expect.any(Boolean),
        })
      );
    });
  });

  it('keeps the project id (not the translation row id) after the merge', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const portfolio = projects.find((p) => p.projectId === '1');

    // The 'en' translation row for Portfolio has its own id ('1'), but so
    // does the 'es' row further down the table ('2') — either way, the
    // merged record must expose the *project's* id, not the translation's.
    expect(portfolio?.id).toBe('1');
    expect(portfolio?.projectId).toBe('1');
  });

  it('joins the requested locale copy and builds locale-prefixed links', async () => {
    const projects = await firstValueFrom(service.getList('es'));
    const portfolio = projects.find((p) => p.id === '1');

    expect(portfolio?.locale).toBe('es');
    expect(portfolio?.tagline).toBe(
      'Este sitio: un monorepo Nx con module federation'
    );
    expect(portfolio?.appLink).toBe('/es');
    expect(portfolio?.detailLink).toBe('/es/projects/portfolio');
  });

  it('falls back to the English copy for an unknown locale', async () => {
    const projects = await firstValueFrom(service.getList('de'));
    const damocles = projects.find((p) => p.id === '2');

    expect(damocles?.locale).toBe('en');
    expect(damocles?.tagline).toBe('VR game studio business site');
  });

  it('omits both detailLink and appLink for the deferred Point Of Sale project', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const pos = projects.find((p) => p.id === '4');

    expect(pos?.detailLink).toBeUndefined();
    expect(pos?.appLink).toBeUndefined();
  });

  it('resolves the Odontogram screenshot import', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const odontogram = projects.find((p) => p.id === '3');

    await expect(odontogram?.image).resolves.toBe('asset-file-stub');
  });

  it('resolves the Portfolio card image import', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const portfolio = projects.find((p) => p.id === '1');

    await expect(portfolio?.image).resolves.toBe('asset-file-stub');
  });

  it("resolves the Damocle'Sword screenshot import", async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const damocles = projects.find((p) => p.id === '2');

    await expect(damocles?.image).resolves.toBe('asset-file-stub');
  });

  it('flags only Portfolio (live app is the site root) as the current site', async () => {
    const projects = await firstValueFrom(service.getList('en'));

    expect(projects.find((p) => p.id === '1')?.isCurrentSite).toBe(true);
    expect(projects.find((p) => p.id === '3')?.isCurrentSite).toBe(false);
    expect(projects.find((p) => p.id === '4')?.isCurrentSite).toBe(false);
  });

  describe('getList filtering', () => {
    it('filters by ids', async () => {
      const projects = await firstValueFrom(
        service.getList('en', { ids: ['2'] })
      );

      expect(projects.map((p) => p.id)).toEqual(['2']);
    });

    it('filters by searchTerm against the project name', async () => {
      const projects = await firstValueFrom(
        service.getList('en', { searchTerm: /odonto/i })
      );

      expect(projects.map((p) => p.id)).toEqual(['3']);
    });

    it('returns every project when no filter is passed', async () => {
      const projects = await firstValueFrom(service.getList('en'));

      expect(projects).toHaveLength(PROJECTS.length);
    });
  });

  describe('getById', () => {
    it('returns a single project joined with the requested locale copy', async () => {
      const odontogram = await firstValueFrom(service.getById('3', 'es'));

      expect(odontogram.id).toBe('3');
      expect(odontogram.locale).toBe('es');
      expect(odontogram.name).toBe('Odontogram');
      expect(odontogram.appLink).toBe('/es/odontogram');
    });

    it('throws NotFoundResourceError for an unknown id', () => {
      expect(() => service.getById('does-not-exist', 'en')).toThrow(
        NotFoundResourceError
      );
    });
  });

  describe('getByDetailSlug', () => {
    it('returns a single project joined with the requested locale copy', async () => {
      const damocles = await firstValueFrom(
        service.getByDetailSlug('damoclesSword', 'es')
      );

      expect(damocles.id).toBe('2');
      expect(damocles.locale).toBe('es');
      expect(damocles.name).toBe("Damocle'Sword");
      expect(damocles.detailLink).toBe('/es/projects/damoclesSword');
    });

    it('throws NotFoundResourceError for a slug with no detail page (e.g. Point Of Sale)', () => {
      expect(() => service.getByDetailSlug('point-of-sale', 'en')).toThrow(
        NotFoundResourceError
      );
    });

    it('throws NotFoundResourceError for an unknown slug', () => {
      expect(() => service.getByDetailSlug('does-not-exist', 'en')).toThrow(
        NotFoundResourceError
      );
    });
  });
});
