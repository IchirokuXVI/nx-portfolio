import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ProjectMemory } from './project-memory';
import { PROJECTS } from './static-project-data';

describe('ProjectMemory', () => {
  let service: ProjectMemory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectMemory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('joins each project with its translation for the requested locale and resolves assets', async () => {
    const projects = await firstValueFrom(service.getList('es'));

    expect(projects).toHaveLength(PROJECTS.length);
    expect(projects[0]).toEqual(
      expect.objectContaining({
        projectId: '1',
        kind: 'client-project',
        label: 'VR Sickness Reducer',
        locale: 'es',
      })
    );
    expect(projects[0].description).toContain('Una prueba diseñada');
    // Addons carry a resolved URL (via the jest asset stub), not an asset key.
    await expect(projects[0].addons?.[0].src).resolves.toBe('asset-file-stub');
  });

  it('falls back to the English description for an unknown locale', async () => {
    const projects = await firstValueFrom(service.getList('de'));
    const starlit = projects.find((p) => p.label === 'STARLIT: ASCENSION');

    expect(starlit?.locale).toBe('en');
    expect(starlit?.description).toContain('Starlit: Ascension is a VR Shooter');
  });

  it('gives the STARLIT: ASCENSION game a right-positioned video and top-right logo', async () => {
    const projects = await firstValueFrom(service.getList('en'));
    const starlit = projects.find((p) => p.label === 'STARLIT: ASCENSION');

    expect(
      starlit?.addons?.map((a) => ({ kind: a.kind, position: a.position }))
    ).toEqual(
      expect.arrayContaining([
        { kind: 'video', position: 'right' },
        { kind: 'image', position: 'top-right' },
      ])
    );
  });

  it('wires the STARLIT: ASCENSION trailer to the correct video asset', () => {
    const starlit = PROJECTS.find((p) => p.label === 'STARLIT: ASCENSION');
    const video = starlit?.addons?.find((a) => a.kind === 'video');

    expect(video?.asset).toBe('starlit-ascension-trailer');
  });
});
