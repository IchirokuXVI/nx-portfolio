import { expect, Locator, Page, test } from '@playwright/test';

/**
 * Guards that every image/trailer inside a given section renders at the same
 * size. These are laid out with equal-width flex tracks + a fixed aspect-ratio
 * media box, so a regression there (an un-constrained intrinsic image, a
 * stretch-to-content thumbnail, a dropped aspect-ratio) shows up as mismatched
 * bounding boxes.
 *
 * Runs through the shell — the only place a remote mounts — at a desktop width
 * wide enough that none of the card rows wrap (wrapping is still equal-size, but
 * a single row keeps the assertion unambiguous).
 */

// Sub-pixel rounding from `aspect-ratio` / flexbox can differ by a fraction.
const TOLERANCE_PX = 1.5;

test.use({ viewport: { width: 1440, height: 900 } });

/** Web-fonts ready + a quiet window with no DOM mutations (mirrors about.spec). */
async function settle(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        let quiet = setTimeout(resolve, 400);
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(resolve, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 8000);
      });
    })
    .catch(() => undefined);
}

/**
 * Asserts every element matched by `selector` shares one bounding-box size.
 * Waits for at least `expectedCount` of them to attach first (media that
 * renders behind an async pipe needs a beat).
 */
async function expectSameSize(
  page: Page,
  selector: string,
  expectedCount: number
): Promise<void> {
  const items: Locator = page.locator(selector);
  await expect(
    items,
    `${selector} should render ${expectedCount} elements`
  ).toHaveCount(expectedCount);
  await items.first().scrollIntoViewIfNeeded();

  const boxes = await items.evaluateAll((els) =>
    els.map((el) => {
      const { width, height } = el.getBoundingClientRect();
      return { width, height };
    })
  );

  const [first] = boxes;
  expect(first.width, `${selector}: width must be > 0`).toBeGreaterThan(0);
  expect(first.height, `${selector}: height must be > 0`).toBeGreaterThan(0);

  for (const box of boxes) {
    expect(
      Math.abs(box.width - first.width),
      `${selector}: widths differ (${JSON.stringify(boxes.map((b) => b.width))})`
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      Math.abs(box.height - first.height),
      `${selector}: heights differ (${JSON.stringify(
        boxes.map((b) => b.height)
      )})`
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  }
}

test.describe('images render at a consistent size per section', () => {
  test('Home — Relevant projects trailers and Latest News thumbnails', async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}`);
    await page
      .locator('lib-damocles-sword-section-projects')
      .waitFor({ state: 'attached', timeout: 30000 });
    await settle(page);

    // Relevant projects: two client trailers + one game trailer.
    await expectSameSize(
      page,
      'lib-damocles-sword-section-projects .card-right-addon video',
      3
    );

    // Latest News thumbnails.
    await expectSameSize(
      page,
      'lib-damocles-sword-section-news .news-thumbnail img',
      2
    );
  });

  test('Services — What we do, Where we fit, and Our projects trailers', async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/services`);
    await page
      .locator('lib-damocles-sword-section-what-we-do')
      .waitFor({ state: 'attached', timeout: 30000 });
    await settle(page);

    await expectSameSize(
      page,
      'lib-damocles-sword-section-what-we-do lib-damocles-sword-info-card .info-card-media img',
      3
    );

    await expectSameSize(
      page,
      'lib-damocles-sword-section-where-we-fit lib-damocles-sword-info-card .info-card-media img',
      4
    );

    await expectSameSize(
      page,
      'lib-damocles-sword-section-projects-detailed .card-media video',
      2
    );
  });

  test('About — Our Values card images', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/about`);
    await page
      .locator('lib-damocles-sword-section-our-values')
      .waitFor({ state: 'attached', timeout: 30000 });
    await settle(page);

    await expectSameSize(
      page,
      'lib-damocles-sword-section-our-values lib-damocles-sword-info-card .info-card-media img',
      4
    );
  });
});
