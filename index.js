const express = require('express');
const router = express.Router();
const db = require('./lib/db');
const scraper = require('./services/scraper');
const playwright = require('playwright');

// In-memory store for Server-Sent Events (SSE) clients
const sseClients = {};

function logToClient(clientId, message) {
  if (sseClients[clientId]) {
    sseClients[clientId].write(`data: ${JSON.stringify({ log: message })}\n\n`);
    console.log(`[${clientId}] ${message}`);
  } else {
    console.log(message);
  }
}

async function logScreenshotToClient(page, clientId, message, force = false) {
  if (process.env.DEBUG_MODE !== 'true' && !force) return;
  logToClient(clientId, message);
  try {
    const imageBuffer = await page.screenshot({ type: 'png', fullPage: true });
    const imageSrc = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    if (sseClients[clientId]) {
      sseClients[clientId].write(`event: screenshot\n`);
      sseClients[clientId].write(`data: ${JSON.stringify({ log: message, imageSrc })}\n\n`);
    }
  } catch (e) {
    logToClient(clientId, `Failed to take screenshot: ${e.message}`);
  }
}

router.get('/', (req, res) => {
  res.render('index', { title: 'Columbus Active Plate Changer' });
});

router.get('/events/:id', (req, res) => {
  const clientId = req.params.id;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  sseClients[clientId] = res;
  req.on('close', () => delete sseClients[clientId]);
});

// Login route: will return cached permits if present, otherwise scrape and cache
router.post('/login/:id', async (req, res) => {
  const clientId = req.params.id;
  try {
    db.init();
    const TTL_HOURS = parseFloat(process.env.PERMIT_TTL_HOURS || '6');
    const TTL_MS = Math.max(0, TTL_HOURS) * 60 * 60 * 1000;
    const cachedRows = db.getAllPermitsWithMeta();
    if (cachedRows && cachedRows.length > 0) {
      const now = Date.now();
      const mapped = cachedRows.map(r => ({ ...r.data, lastSynced: r.lastSynced, stale: (now - r.lastSynced) > TTL_MS }));
      const activeCached = mapped.filter(p => p.status === 'Active');
      logToClient(clientId, `Serving ${activeCached.length} active permits from cache (${mapped.length} total cached). TTL=${TTL_HOURS}h`);
      return res.render('permits', { title: 'Your Active Permits', permits: activeCached, baseUrl: scraper.BASE_URL });
    }

    logToClient(clientId, 'No cached permits found. Scraping now...');
    const permits = await scraper.scrapeAndCacheAll(clientId, (id, msg) => logToClient(id, msg));
    res.render('permits', { title: 'Your Active Permits', permits, baseUrl: scraper.BASE_URL });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).render('index', { title: 'Columbus Active Plate Changer', message: `A critical error occurred: ${error.message}` });
  }
});

// Sync endpoint to force-refresh cached permits
router.post('/sync/:id', async (req, res) => {
  const clientId = req.params.id;
  try {
    logToClient(clientId, 'Starting synchronization (forced)...');
    await scraper.scrapeAndCacheAll(clientId, (id, msg) => logToClient(id, msg), true);
    // reload from DB so we have lastSynced timestamps
    const now = Date.now();
    const rows = db.getAllPermitsWithMeta();
    const mapped = rows.map(r => ({ ...r.data, lastSynced: r.lastSynced, stale: (now - r.lastSynced) > TTL_MS }));
    const activePermits = mapped.filter(p => p.status === 'Active');
    res.render('permits', { title: 'Your Active Permits', permits: activePermits, baseUrl: scraper.BASE_URL });
  } catch (error) {
    logToClient(clientId, `Sync error: ${error.message}`);
    res.status(500).render('index', { title: 'Columbus Active Plate Changer', message: `Sync failed: ${error.message}` });
  }
});

// Debug: show DB counts
router.get('/debug/db', (req, res) => {
  try {
    db.init();
    const permits = db.getAllPermits();
    const session = db.getSession('playwrightStorage');
    res.json({ permits: permits.length, hasSession: !!session, sessionLastUpdated: session ? session.lastUpdated : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Keep update-plate route (unchanged logic) — attempts login and performs update
router.post('/update-plate/:id', async (req, res) => {
  let browser;
  const clientId = req.params.id;
  const { detailPageUrl, plateToActivate, currentPlate } = req.body;

  try {
    logToClient(clientId, `Starting update process...`);
    logToClient(clientId, ` -> Deactivating: ${currentPlate}`);
    logToClient(clientId, ` -> Activating:   ${plateToActivate}`);
    browser = await playwright.chromium.launch({
      args: ['--no-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login
    logToClient(clientId, 'Logging in...');
    await page.goto(`${scraper.BASE_URL}/index.aspx`);
    await page.getByText('Account Login').click();
    const usernameField = page.locator('input[name*="txtEmailAddress"]');
    await usernameField.waitFor({ state: 'visible' });
    await usernameField.fill(process.env.SCRAPER_USERNAME);
    await page.locator('input[name*="txtPassword"]').fill(process.env.SCRAPER_PASSWORD);
    await Promise.all([
      page.waitForResponse(response => response.url().includes('index.aspx') && response.request().method() === 'POST'),
      page.locator('input[name*="btnLogin"]').click(),
    ]);
    await page.waitForLoadState('networkidle');
    logToClient(clientId, 'Login successful.');

    // Navigate to the permit detail page
    logToClient(clientId, 'Navigating to permit detail page...');
    await page.goto(new URL(detailPageUrl, scraper.BASE_URL).href);
    await page.waitForLoadState('networkidle');

    // First, find and uncheck the currently active plate.
    logToClient(clientId, `Finding and unchecking current plate (${currentPlate})...`);
    const activeCheckbox = page.locator('div.dti-checkbox-selected[id$="_rgnCheckBox"]');
    if (await activeCheckbox.count() > 0) {
      // Click the active checkbox and wait for it to be removed (no longer selected).
      try {
        await Promise.all([
          page.waitForResponse(resp => resp.url().includes('index.aspx') && resp.status() === 200),
          activeCheckbox.click()
        ]);
        // Wait specifically for the checkbox to lose the 'dti-checkbox-selected' class.
        await page.waitForFunction(() => !document.querySelector('div.dti-checkbox-selected[id$="_rgnCheckBox"]'), { timeout: 10000 }).catch(() => {});
        // Small pause to allow animations/DOM settle before screenshot
        await page.waitForTimeout(300);
        await logScreenshotToClient(page, clientId, 'Screenshot after unchecking old plate.');
      } catch (e) {
        logToClient(clientId, `Warning: couldn't confirm uncheck state: ${e.message}`);
      }
    }

    logToClient(clientId, `Finding and checking new plate (${plateToActivate})...`);
    const vehicleRow = page.locator('div.dti-tile-vehicle-lg', { has: page.locator('a[id*="_lnkVehiclePlate"]', { hasText: plateToActivate }) });
    const setActiveCheckbox = vehicleRow.locator('div[id$="_rgnCheckBox"]');
    try {
      await Promise.all([
        setActiveCheckbox.click(),
        // Wait for server response (status 200) related to the page to be safe
        page.waitForResponse(resp => resp.url().includes('index.aspx') && resp.status() === 200),
      ]);

      // Wait for the checkbox to have the selected class within this vehicle row
      const selectedLocator = vehicleRow.locator('div[id$="_rgnCheckBox"].dti-checkbox-selected');
      await selectedLocator.waitFor({ state: 'visible', timeout: 10000 });
      // Small pause to allow animations/DOM settle before screenshot
      await page.waitForTimeout(300);
      await logScreenshotToClient(page, clientId, 'Screenshot after checking new plate.');
    } catch (e) {
      logToClient(clientId, `Warning: couldn't confirm new plate was selected: ${e.message}`);
      // Best-effort screenshot anyway
      await page.waitForTimeout(300);
      await logScreenshotToClient(page, clientId, 'Screenshot after checking new plate (unconfirmed).');
    }

    logToClient(clientId, 'Clicking "Update Permit" to save changes...');
    await Promise.all([
      page.locator('input[name*="btnContinue"][value="Update Permit"]').click(),
      page.waitForResponse(async resp => resp.url().includes('index.aspx') && (await resp.text()).includes('<span id="ApplicationContent_PermitLayout_PermitDashboard_lblTitle">Permit Dashboard</span>')),
    ]);

    await logScreenshotToClient(page, clientId, 'Final screenshot of dashboard after update.', true);

    // Update cached permit in DB so UI reflects the new active plate immediately
    try {
      db.init();
      const rows = db.getAllPermitsWithMeta();
      const match = rows.find(r => r.data && r.data.detailPageUrl === detailPageUrl);
      if (match && match.data && match.data.permitNo) {
        const updated = Object.assign({}, match.data, { vehicle: plateToActivate });
        db.savePermit(updated.permitNo, updated);
        logToClient(clientId, `Cache updated for permit ${updated.permitNo} -> ${plateToActivate}`);
      } else {
        logToClient(clientId, 'No matching cached permit found to update.');
      }
    } catch (e) {
      logToClient(clientId, `Failed to update cache: ${e.message}`);
    }

    logToClient(clientId, 'Update successful! The screenshot above confirms the change.');
    res.json({ success: true, message: 'Update complete. Please see the final screenshot for confirmation.' });

  } catch (error) {
    logToClient(clientId, `Error updating plate: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

router.get('/update-status', (req, res) => {
  res.render('update-status', { title: 'Updating Permit' });
});

module.exports = router;