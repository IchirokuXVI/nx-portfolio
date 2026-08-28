import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { fontsReady } from './support/locale-helpers';

/**
 * Guards the layout promises the trailer video makes on the damoclesSword home
 * page:
 *
 *  1. It spans the full viewport width at 1920px and below.
 *  2. It is never hidden by the scroll — its bottom edge stays within the
 *     viewport on load, so the whole trailer is visible without scrolling.
 *  3. As a design guideline (not a hard number), the header + trailer together
 *     take roughly 70% of the viewport height on a 1920x1080 screen.
 *
 * The video is intentionally shorter than a full 16:9 frame and cropped
 * (top/bottom) to stay full width, so the "fits on screen" check bites rather
 * than passing trivially. Each case loads fresh at the target size (the real
 * user scenario) rather than resizing into it.
 */

const TRAILER = 'lib-damocles-sword-trailer-video video';

// Sub-pixel rounding can leave the video a hair under the viewport width or a
// hair over its bottom without it being a real defect.
const TOLERANCE_PX = 1;

const viewports = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1920-short', width: 1920, height: 800 },
  { name: 'below-1920', width: 1600, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-420', width: 420, height: 812 },
  { name: 'mobile-sm', width: 320, height: 720 },
];

interface TrailerBox {
  width: number;
  bottom: number;
  innerWidth: number;
  innerHeight: number;
}

/**
 * Wait for the lazy-loaded remote to mount, then read the video's geometry
 * relative to the viewport.
 */
async function readTrailerBox(page: Page): Promise<TrailerBox> {
  const video = page.locator(TRAILER);
  await video.waitFor({ state: 'attached', timeout: 30000 });

  // Web fonts can nudge the header height (and so the trailer's top); wait for
  // them so the geometry we read is final.
  await fontsReady(page);

  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const rect = el.getBoundingClientRect();
    return {
      width: rect.width,
      bottom: rect.bottom,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  }, TRAILER);
}

for (const viewport of viewports) {
  test(`trailer is full width and never hidden by scroll at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
    page,
    baseURL,
  }) => {
    expect(
      baseURL,
      'baseURL must be configured in playwright.config.ts'
    ).toBeTruthy();

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto(baseURL as string);

    const box = await readTrailerBox(page);

    const detail =
      `\n${viewport.name} (${viewport.width}x${viewport.height}):` +
      `\n  video width=${Math.round(box.width)} (viewport ${box.innerWidth})` +
      `\n  video bottom=${Math.round(box.bottom)} (viewport height ${box.innerHeight})`;

    // 1. Full width at 1920px and below.
    expect
      .soft(box.width, `Trailer is not full width.${detail}`)
      .toBeGreaterThanOrEqual(box.innerWidth - TOLERANCE_PX);

    // 2. Never hidden by the scroll — bottom stays within the viewport on load.
    expect
      .soft(
        box.bottom,
        `Trailer extends past the viewport (hidden by scroll).${detail}`
      )
      .toBeLessThanOrEqual(box.innerHeight + TOLERANCE_PX);
  });
}

test('trailer is muted and autoplays on load', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL as string);

  const video = page.locator(TRAILER);
  await video.waitFor({ state: 'attached', timeout: 30000 });

  // Muted by default — this is also what lets it autoplay without a user
  // gesture, so no JS is needed to kick playback off.
  await expect(video).toHaveJSProperty('muted', true);

  // Autoplaying: it isn't paused and its playback position advances on its own.
  await expect(video).toHaveJSProperty('paused', false);
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), {
      message: 'Trailer did not start playing on load.',
      timeout: 10000,
    })
    .toBeGreaterThan(0);
});

test('the stop/resume control pauses and resumes the trailer', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL as string);

  const video = page.locator(TRAILER);
  await video.waitFor({ state: 'attached', timeout: 30000 });
  await expect(video).toHaveJSProperty('paused', false);

  // The label flips with state, so it doubles as an assertion the icon swapped.
  await page.getByRole('button', { name: 'Pause trailer' }).click();
  await expect(video).toHaveJSProperty('paused', true);

  await page.getByRole('button', { name: 'Play trailer' }).click();
  await expect(video).toHaveJSProperty('paused', false);
});

test('the mute control mutes and unmutes the trailer', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL as string);

  const video = page.locator(TRAILER);
  await video.waitFor({ state: 'attached', timeout: 30000 });
  await expect(video).toHaveJSProperty('muted', true);

  await page.getByRole('button', { name: 'Unmute trailer' }).click();
  await expect(video).toHaveJSProperty('muted', false);

  await page.getByRole('button', { name: 'Mute trailer' }).click();
  await expect(video).toHaveJSProperty('muted', true);
});

test('header + trailer take roughly 70% of the viewport height at 1920x1080', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseURL as string);

  const box = await readTrailerBox(page);

  // `box.bottom` is measured from the top of the viewport, so it already spans
  // the header + trailer. This is a design guideline, so allow generous slack.
  const ratio = box.bottom / box.innerHeight;
  expect(
    ratio,
    `Header + trailer should sit around 70% of the viewport height, got ` +
      `${Math.round(ratio * 100)}% (bottom=${Math.round(box.bottom)} of ${box.innerHeight}).`
  ).toBeGreaterThanOrEqual(0.6);
  expect(ratio).toBeLessThanOrEqual(0.8);
});
