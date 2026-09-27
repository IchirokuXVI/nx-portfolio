import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { WalkDb } from '../storage/walk-db';
import { WalkFiles } from '../storage/walk-files';
import { WalkLabState } from '../walk-lab-state';
import { WalkListPage } from './walk-list-page';

@Component({ selector: 'lib-test-page', template: '' })
class TestPage {}

const FIXTURES = resolve(
  __dirname,
  '../../../../../luna-shopper/shop-map/recorder/src/__fixtures__/walks'
);

function fixtureText(name: string): string {
  const dir = join(FIXTURES, name);
  const file = readdirSync(dir).find((f) => f.endsWith('.geojson')) as string;
  return readFileSync(join(dir, file), 'utf8');
}

/** A file input holding one picked file. */
function picked(name: string, text: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  const file = new File([text], name);
  // jsdom's File has no `text()`, and `WalkFiles.read` is what reads it anyway.
  Object.defineProperty(input, 'files', { value: [file] });
  return input;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('WalkListPage', () => {
  let read: jest.Mock;

  beforeEach(() => {
    read = jest.fn();
    TestBed.configureTestingModule({
      imports: [WalkListPage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        provideRouter([{ path: '**', component: TestPage }]),
        provideVelistaTesting(),
        provideFakeBrowserFacade(),
        WalkDb,
        WalkLabState,
        { provide: WalkFiles, useValue: { read, download: jest.fn() } },
      ],
    });
  });

  it('imports a walk file into the list', async () => {
    const page = TestBed.createComponent(WalkListPage).componentInstance;
    read.mockResolvedValue(fixtureText('straight-aisle'));

    await page.import(picked('walk.geojson', ''));
    await settle();

    expect(page.notice()?.key).toBe('walkLab.import.saved');
    expect(page.walks()).toHaveLength(1);
  });

  it('opens a plain GeoJSON as tracks to look at, and does not save it', async () => {
    const page = TestBed.createComponent(WalkListPage).componentInstance;
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const geojson = JSON.parse(fixtureText('l-shape'));
    delete geojson.walk;
    read.mockResolvedValue(JSON.stringify(geojson));

    await page.import(picked('edited.geojson', ''));
    await settle();

    expect(
      TestBed.inject(WalkLabState).imported()?.tracks.length
    ).toBeGreaterThan(0);
    expect(navigate).toHaveBeenCalledWith(['imported'], expect.anything());
    expect(await TestBed.inject(WalkDb).list()).toEqual([]);
  });

  it('says why a file cannot be read, with the error code', async () => {
    const page = TestBed.createComponent(WalkListPage).componentInstance;
    read.mockResolvedValue('not json at all');

    await page.import(picked('photo.jpg', ''));

    expect(page.notice()).toEqual({
      tone: 'danger',
      key: 'walkLab.import.error.NOT_JSON',
    });
  });

  it('deletes a walk only on the second tap', async () => {
    const page = TestBed.createComponent(WalkListPage).componentInstance;
    read.mockResolvedValue(fixtureText('straight-aisle'));
    await page.import(picked('walk.geojson', ''));
    await settle();
    const walk = page.walks()?.[0];
    if (!walk) {
      throw new Error('expected a walk');
    }

    page.askDelete(walk);
    expect(page.confirming()).toBe(walk.id);
    expect(page.walks()).toHaveLength(1);

    await page.confirmDelete(walk);
    expect(page.walks()).toEqual([]);
  });
});
