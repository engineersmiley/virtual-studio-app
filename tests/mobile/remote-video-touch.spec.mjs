import { test, expect } from '@playwright/test';

const pageErrors = new WeakMap();
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

const clicks = page => page.evaluate(() =>
  window.remoteTouchTest.commands.filter(command => command.type === 'mouse-click'));

async function settle(page) {
  // Let the 50ms click queue and the browser's compatibility mouse events drain.
  await page.waitForTimeout(150);
}

async function setup(page, fullscreen = false, control = true) {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/session/TOUCH1/engineer${control ? '' : '?control=off'}`);
  const inline = page.locator('video').filter({ visible: true }).first();
  await expect(inline).toBeVisible();
  await expect.poll(() => inline.evaluate(video => video.videoWidth)).toBe(1920);
  // Dismiss the real audio prompt so gestures hit the video, not its overlay.
  await page.getByTestId('button-enable-audio-prompt').click();
  await expect(page.getByTestId('button-enable-audio-prompt')).toBeHidden();
  if (fullscreen) {
    // Enter with a click so any touch compatibility event from the toggle is
    // separate from the video gestures under test.
    await page.getByTestId('button-fullscreen').click();
  }
  const video = fullscreen
    ? page.locator('video').filter({ visible: true }).first()
    : inline;
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate(video => video.videoWidth)).toBe(1920);
  await settle(page);
  await page.evaluate(() => { window.remoteTouchTest.commands.length = 0; });
  await video.evaluate(video => {
    const container = video.parentElement;
    window.remoteTouchTest.video = video;
    window.remoteTouchTest.container = container;
    window.remoteTouchTest.events = [];
    const record = phase => event => {
      window.remoteTouchTest.events.push({
        type: event.type, phase, trusted: event.isTrusted,
        target: event.target === video ? 'video' : event.target === container ? 'container' : 'other',
        touchMouse: event.sourceCapabilities?.firesTouchEvents ?? false,
        touches: event.touches ? Array.from(event.touches, t => ({ id: t.identifier, x: t.clientX, y: t.clientY })) : undefined,
      });
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click']) {
      container.addEventListener(type, record('capture'), true);
      container.addEventListener(type, record('bubble'));
    }
  });
  const box = await video.boundingBox();
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(100);
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), id: 1 };
  expect(await video.evaluate((video, { x, y }) =>
    document.elementFromPoint(x, y) === video, point)).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type, points = []) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(({ x, y, id = 1 }) => ({ x, y, id })),
    });
    // Distinct compositor frames prevent coalescing an away-and-back move.
    await page.waitForTimeout(35);
  };
  return { video, box, point, touch, errors };
}

for (const fullscreen of [false, true]) {
  test.describe(fullscreen ? 'mobile fullscreen video' : 'mobile inline video', () => {
    test('tap clicks once and native default prevention suppresses compatibility clicks', async ({ page }) => {
      const { point, errors } = await setup(page, fullscreen);
      await page.touchscreen.tap(point.x, point.y);
      await settle(page);
      expect(await clicks(page)).toEqual([{ type: 'mouse-click', button: 'left' }]);
      const events = await page.evaluate(() => window.remoteTouchTest.events.filter(e => e.phase === 'capture'));
      expect(events.every(e => e.trusted)).toBe(true);
      expect(events.find(e => e.type === 'touchstart').target).toBe('video');
      expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['touchstart', 'touchend']));
      const types = events.map(e => e.type);
      expect(types.indexOf('touchstart')).toBeLessThan(types.indexOf('touchend'));
      // Inline cancels touchend; fullscreen also cancels touchstart.
      expect(types).not.toContain('mousedown');
      expect(types).not.toContain('mouseup');
      expect(types).not.toContain('click');
      expect(errors).toEqual([]);
    });

    test('drag returning to origin moves but never clicks or scrolls', async ({ page }) => {
      const { point, touch, video } = await setup(page, fullscreen);
      expect(await video.evaluate(video => getComputedStyle(video).touchAction)).toBe('none');
      const before = await page.evaluate(() => ({ x: scrollX, y: scrollY, scale: visualViewport.scale }));
      await touch('touchStart', [point]);
      await touch('touchMove', [{ ...point, y: point.y - 65 }]);
      await touch('touchMove', [point]);
      await touch('touchEnd');
      await settle(page);
      expect(await clicks(page)).toEqual([]);
      expect(await page.evaluate(() => window.remoteTouchTest.events.filter(e =>
        e.type === 'touchmove' && e.phase === 'capture').length)).toBeGreaterThanOrEqual(2);
      const diagnostic = await page.evaluate(() => ({
        events: window.remoteTouchTest.events, commands: window.remoteTouchTest.commands,
      }));
      expect(diagnostic.commands.some(c => c.type === 'mouse-move'), JSON.stringify(diagnostic)).toBe(true);
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, scale: visualViewport.scale }))).toEqual(before);
      expect(await page.evaluate(() => window.remoteTouchTest.events.some(e => e.type === 'touchcancel'))).toBe(false);
    });

    test('second finger rejects the whole gesture even after it lifts; next tap works', async ({ page }) => {
      const { point, touch } = await setup(page, fullscreen);
      const second = { x: point.x + 45, y: point.y + 20, id: 2 };
      await touch('touchStart', [point]);
      await touch('touchStart', [point, second]);
      await touch('touchMove', [point, { ...second, x: second.x + 20 }]);
      await touch('touchEnd', [point]);
      await touch('touchEnd');
      await settle(page);
      expect(await clicks(page)).toEqual([]);
      await page.touchscreen.tap(point.x, point.y);
      await settle(page);
      expect(await clicks(page)).toHaveLength(1);
    });

    test('browser cancellation does not click and permits a fresh tap', async ({ page }) => {
      const { point, touch } = await setup(page, fullscreen);
      await touch('touchStart', [point]);
      await touch('touchCancel');
      await settle(page);
      expect(await clicks(page)).toEqual([]);
      expect(await page.evaluate(() => window.remoteTouchTest.events.some(e =>
        e.type === 'touchcancel' && e.trusted))).toBe(true);
      await page.touchscreen.tap(point.x, point.y);
      await settle(page);
      expect(await clicks(page)).toHaveLength(1);
    });
  });
}

test('trusted compatibility mouse events reaching the inline container cannot duplicate a touch click', async ({ page }) => {
  const { point, touch, video } = await setup(page);
  // Expose an unambiguous surrounding area regardless of the video's aspect
  // ratio. Only layout changes; the real container handlers and touch-action
  // rules remain untouched.
  const outside = await video.evaluate(video => {
    const container = video.parentElement;
    container.style.paddingBottom = '80px';
    const rect = container.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.bottom - 20 };
  });
  expect(await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y) === window.remoteTouchTest.container, outside)).toBe(true);
  // A canceled video gesture sets the same suppression window as taps/drags.
  await touch('touchStart', [point]);
  await touch('touchCancel');
  await page.touchscreen.tap(outside.x, outside.y);
  await settle(page);
  expect(await clicks(page)).toEqual([]);
  const events = await page.evaluate(() => window.remoteTouchTest.events.filter(e =>
    e.target === 'container' && e.phase === 'bubble'));
  expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['touchstart', 'touchend', 'mousedown', 'mouseup', 'click']));
  expect(events.every(e => e.trusted)).toBe(true);
  const types = events.map(e => e.type);
  expect(types.indexOf('touchend')).toBeLessThan(types.indexOf('mousedown'));
  expect(types.indexOf('mousedown')).toBeLessThan(types.indexOf('mouseup'));
  expect(types.indexOf('mouseup')).toBeLessThan(types.indexOf('click'));
  expect(events.find(e => e.type === 'click').touchMouse).toBe(true);
  // Prove this is the live remote-click path, not a disconnected observer.
  await page.waitForTimeout(550);
  await page.touchscreen.tap(outside.x, outside.y);
  await settle(page);
  expect(await clicks(page)).toHaveLength(1);
});

test('inline viewing without authorization still allows normal page scrolling', async ({ page }) => {
  const { point, touch, video } = await setup(page, false, false);
  expect(await video.evaluate(video => getComputedStyle(video).touchAction)).toBe('auto');
  const before = await page.evaluate(() => scrollY);
  await touch('touchStart', [point]);
  await touch('touchMove', [{ ...point, y: point.y - 90 }]);
  await touch('touchMove', [{ ...point, y: point.y - 130 }]);
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  expect(await clicks(page)).toEqual([]);
});
