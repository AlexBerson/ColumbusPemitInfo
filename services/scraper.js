const playwright = require('playwright');
const db = require('../lib/db');
const BASE_URL = 'https://columbus.permitinfo.net';

async function scrapeAndCacheAll(clientId, logFn = () => {}, force = false) {
  db.init();

  let browser;
  try {
    browser = await playwright.chromium.launch({ args: ['--no-sandbox'] });
    const stored = db.getSession('playwrightStorage');
    const contextOptions = {};
    if (stored && !force) {
      logFn(clientId, 'Using cached session storage for Playwright context.');
      contextOptions.storageState = stored.storageState;
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // If there's no stored session or force is true, perform login
    // If there's no stored session or force is true, perform login
    if (!stored || force) {
      logFn(clientId, 'Performing login flow...');
      await page.goto(`${BASE_URL}/index.aspx`);
      await page.getByText('Account Login').click();
      const usernameField = page.locator('input[name*="txtEmailAddress"]');
      const passwordField = page.locator('input[name*="txtPassword"]');
      const loginButton = page.locator('input[name*="btnLogin"]');
      await usernameField.waitFor({ state: 'visible' });
      await usernameField.fill(process.env.SCRAPER_USERNAME);
      await passwordField.fill(process.env.SCRAPER_PASSWORD);
      await Promise.all([
        page.waitForResponse(response => response.url().includes('index.aspx') && response.request().method() === 'POST'),
        loginButton.click()
      ]);
      await page.waitForLoadState('networkidle');
      // Save storage state to DB for reuse
      try {
        const storage = await context.storageState();
        db.saveSession('playwrightStorage', storage);
        logFn(clientId, 'Saved new session storage to DB.');
      } catch (e) {
        logFn(clientId, `Failed to save session storage: ${e.message}`);
      }
    } else {
      // If using stored state, ensure page is at dashboard
      logFn(clientId, 'Navigating to dashboard with stored session...');
      await page.goto(`${BASE_URL}/index.aspx`);
      await page.waitForLoadState('networkidle');

      // Check whether the stored session is still valid by looking for 'Account Login'
      const loginPromptCount = await page.getByText('Account Login').count();
      if (loginPromptCount > 0) {
        logFn(clientId, 'Stored session expired or invalid; performing login flow.');
        const usernameField = page.locator('input[name*="txtEmailAddress"]');
        const passwordField = page.locator('input[name*="txtPassword"]');
        const loginButton = page.locator('input[name*="btnLogin"]');
        await usernameField.waitFor({ state: 'visible' });
        await usernameField.fill(process.env.SCRAPER_USERNAME);
        await passwordField.fill(process.env.SCRAPER_PASSWORD);
        await Promise.all([
          page.waitForResponse(response => response.url().includes('index.aspx') && response.request().method() === 'POST'),
          loginButton.click()
        ]);
        await page.waitForLoadState('networkidle');
        try {
          const storage = await context.storageState();
          db.saveSession('playwrightStorage', storage);
          logFn(clientId, 'Saved refreshed session storage to DB.');
        } catch (e) {
          logFn(clientId, `Failed to save refreshed session storage: ${e.message}`);
        }
      }
    }

    logFn(clientId, 'Scraping permit rows...');
    const permitRows = await page.locator('div[id*="_rgnDashboardItem"].dti-dash-item-panel').all();
    const allPermits = [];
    for (const row of permitRows) {
      try {
        const detailLink = row.locator('span[id*="_lblCartItemDescription"] a');
        const detailPageUrl = await detailLink.getAttribute('href', { timeout: 1000 }).catch(() => null);

        const permitData = {
          permitNo: await row.locator('span[id*="_lblPermitNo"]').innerText(),
          detailPageUrl: detailPageUrl,
          status: await row.locator('span[id*="_lblStatus"]').innerText(),
          description: await row.locator('span[id*="_lblCartItemDescription"]').innerText(),
          validFrom: await row.locator('span[id*="_lblFrom"]').innerText(),
          validTo: await row.locator('span[id*="_lblTo"]').innerText(),
          holder: await row.locator('span[id*="_lblPermitHolder"]').first().innerText(),
          vehicle: await row.locator('span[id*="_lblVehicles"]').innerText(),
          availablePlates: [],
        };
        allPermits.push(permitData);
      } catch (e) {
        logFn(clientId, `Could not parse a permit row: ${e.message}`);
      }
    }

    const activePermits = allPermits.filter(p => p.status === 'Active');

    // Save all permits to the DB so cache is available even if some are inactive
    try {
      for (const permit of allPermits) {
        db.savePermit(permit.permitNo, permit);
      }
    } catch (e) {
      logFn(clientId, `Failed to save permits to DB: ${e.message}`);
    }

    // For each active permit, fetch plates and cache them (update existing cache)
    await Promise.all(activePermits.map(async (permit) => {
      if (!permit.detailPageUrl) return;
      logFn(clientId, `Fetching plates for permit #${permit.permitNo}...`);
      const permitPage = await context.newPage();
      try {
        await permitPage.goto(new URL(permit.detailPageUrl, BASE_URL).href);
        await permitPage.waitForLoadState('networkidle');
        const plateRows = await permitPage.locator('div.dti-tile-vehicle-lg').all();
        for (const plateRow of plateRows) {
          const plate = await plateRow.locator('a[id*="_lnkVehiclePlate"]').innerText();
          const name = await plateRow.locator('span[id*="_lblVehicleMake"]').innerText();
          permit.availablePlates.push({ plate, name });
        }
        // Save to DB
        db.savePermit(permit.permitNo, permit);
      } catch (e) {
        logFn(clientId, `Could not fetch plates for permit #${permit.permitNo}: ${e.message}`);
      } finally {
        await permitPage.close();
      }
    }));

    await page.close();
    await context.close();
    return activePermits;
  } catch (err) {
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeAndCacheAll, BASE_URL };
