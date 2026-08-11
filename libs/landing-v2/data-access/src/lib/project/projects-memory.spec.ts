import { TestBed } from '@angular/core/testing';
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

  it('joins the requested locale copy and builds locale-prefixed links', async () => {
    const projects = await firstValueFrom(service.getList('es'));
    const portfolio = projects.find((p) => p.projectId === '1');

    expect(portfolio?.locale).toBe('es');
    expect(portfolio?.tagline).toBe(
      'Este sitio — un monorepo Nx con module federation'
    );
    expect(portfolio?.appLink).toBe('/es');
    expect(portfolio?.detailLink).toBe('/es/projects/portfolio');
  });

  it('falls back to the English copy for an unknown locale', async () => {
    const projects = await firstValueFrom(service.getList('de'));
    const damocles = projects.find((p) => p.projectId === '2');

    expect(damocles?.locale).toBe('en');
    expect(damocles?.tagline).toBe(
      "VR game studio site, ported into the portfolio"
    );
  });

  it('omits detailLink for the deferred Point Of Sale detail page', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const pos = projects.find((p) => p.projectId === '4');

    expect(pos?.detailLink).toBeUndefined();
    expect(pos?.appLink).toBe('/en/point-of-sale');
  });

  it('resolves the Odontogram screenshot import', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const odontogram = projects.find((p) => p.projectId === '3');

    await expect(odontogram?.image).resolves.toBe('asset-file-stub');
  });

  it('leaves Portfolio and Damocle\'Sword without a screenshot (generic placeholder)', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const portfolio = projects.find((p) => p.projectId === '1');
    const damocles = projects.find((p) => p.projectId === '2');

    expect(portfolio?.image).toBeUndefined();
    expect(damocles?.image).toBeUndefined();
  });
});
