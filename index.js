const express = require('express');
const router = express.Router();
const playwright = require('playwright');

const BASE_URL = 'https://columbus.permitinfo.net';

// In-memory store for Server-Sent Events (SSE) clients
const sseClients = {};

// Helper function to send log messages to a specific client
function logToClient(clientId, message) {
  if (sseClients[clientId]) {
    sseClients[clientId].write(`data: ${JSON.stringify({ log: message })}\n\n`);
    console.log(`[${clientId}] ${message}`);
  } else {
    console.log(message);
  }
}

// Helper function to send a screenshot to a specific client
async function logScreenshotToClient(page, clientId, message) {
  // Only run this function if debug mode is explicitly enabled
  if (process.env.DEBUG_MODE !== 'true') return;

  logToClient(clientId, message); // Send the text log first
  try {
    const imageBuffer = await page.screenshot({ type: 'png' });
    const imageSrc = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    if (sseClients[clientId]) {
      // Send a custom 'screenshot' event
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

// Endpoint for the client to establish an SSE connection
router.get('/events/:id', (req, res) => {
  const clientId = req.params.id;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  sseClients[clientId] = res;
  req.on('close', () => delete sseClients[clientId]);
});

router.post('/login/:id', async (req, res) => {
  let browser;
  let page; // Define page here to access it in the catch block
  try {
    // Launch a new headless browser instance for each login request.
    browser = await playwright.chromium.launch({
      args: ['--no-sandbox'] // Necessary for Docker environments
    });
    const context = await browser.newContext();
    page = await context.newPage();
    const clientId = req.params.id;

    logToClient(clientId, 'Navigating to the initial page...');
    await page.goto(`${BASE_URL}/index.aspx`);

    logToClient(clientId, 'Clicking "Account Login"...');
    // Playwright can find elements by the text they contain.
    await page.getByText('Account Login').click();

    // Wait for the login form elements to be visible.
    logToClient(clientId, 'Filling out login form...');
    const usernameField = page.locator('input[name*="txtEmailAddress"]');
    const passwordField = page.locator('input[name*="txtPassword"]');
    const loginButton = page.locator('input[name*="btnLogin"]');

    await usernameField.waitFor({ state: 'visible' });

    // Fill in the credentials from environment variables.
    await usernameField.fill(process.env.SCRAPER_USERNAME);
    await passwordField.fill(process.env.SCRAPER_PASSWORD);

    logToClient(clientId, 'Submitting login form...');
    // The login is an AJAX request. Instead of waiting for navigation,
    // we wait for the specific POST response from the server.
    await Promise.all([
      page.waitForResponse(response => response.url().includes('index.aspx') && response.request().method() === 'POST'),
      loginButton.click(),
    ]);

    // After the AJAX response is received, wait for the client-side
    // JavaScript to finish updating the DOM. 'networkidle' is a good
    // signal that the page has settled down.
    logToClient(clientId, 'AJAX response received. Waiting for page to update...');
    await page.waitForLoadState('networkidle');

    logToClient(clientId, 'Login successful. Scraping permit data...');

    // Scrape the permit data from the page.
    const permitRows = await page.locator('div[id*="_rgnDashboardItem"].dti-dash-item-panel').all();
    
    const allPermits = [];
    for (const row of permitRows) {
      // Use a try-catch for each field to be resilient against missing data
      try {
        // For expired/inactive permits, the detail link may not exist.
        // Use a short timeout to avoid waiting 30s for nothing.
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
        console.warn('Could not parse a permit row, skipping.', e.message);
      }
    }

    // Filter for active permits only, as requested.
    const activePermits = allPermits.filter(p => p.status === 'Active');

    // For each active permit, fetch the available license plates in the background.
    logToClient(clientId, `Found ${activePermits.length} active permits. Fetching available plates for each...`);
    await Promise.all(activePermits.map(async (permit) => {
      if (!permit.detailPageUrl) return;
      logToClient(clientId, `Fetching plates for permit #${permit.permitNo}...`);
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
      } catch (e) {
        logToClient(clientId, `Could not fetch plates for permit #${permit.permitNo}: ${e.message}`);
      } finally {
        await permitPage.close();
      }
    }));


    logToClient(clientId, 'All data scraped. Rendering results.');
    res.render('permits', { title: 'Your Active Permits', permits: activePermits });

  } catch (error) {
    console.error('An error occurred:', error.message);

    // If an error occurs, try to take a screenshot for debugging and send it to the user.
    if (page) {
      try {
        console.log('Error occurred. Taking a screenshot for debugging...');
        const imageBuffer = await page.screenshot({ fullPage: true });
        const imageSrc = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        return res.render('result', { title: 'Scraper Error', imageSrc, error: error.message });
      } catch (screenshotError) {
        console.error('Could not take screenshot:', screenshotError.message);
      }
    }
    res.status(500).render('index', { title: 'Columbus Active Plate Changer', message: `A critical error occurred: ${error.message}` });
  } finally {
    // Ensure the browser is always closed.
    if (browser) {
      await browser.close();
    }
  }
});

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
    await page.goto(`${BASE_URL}/index.aspx`);
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
    await page.goto(new URL(detailPageUrl, BASE_URL).href);
    await page.waitForLoadState('networkidle');

    // First, find and uncheck the currently active plate.
    // The active checkbox has a 'dti-checkbox-selected' class.
    logToClient(clientId, `Finding and unchecking current plate (${currentPlate})...`);
    const activeCheckbox = page.locator('div.dti-checkbox-selected[id$="_rgnCheckBox"]');
    // Check if an active checkbox exists before trying to click it.
    if (await activeCheckbox.count() > 0) {
      await Promise.all([
        // Wait for the server response that confirms the uncheck action.
        // The response body will no longer contain the 'dti-checkbox-selected' class for this element.
        // A simple status check is sufficient and more reliable for the uncheck action.
        page.waitForResponse(resp => resp.url().includes('index.aspx') && resp.status() === 200),
        activeCheckbox.click()
      ]);
      // It's good practice to also wait for the DOM to settle after the response.
      await page.waitForLoadState('networkidle');
      await logScreenshotToClient(page, clientId, 'Screenshot after unchecking old plate.');
    }

    // Find the vehicle row and click the 'Set Active' checkbox
    logToClient(clientId, `Finding and checking new plate (${plateToActivate})...`);
    const vehicleRow = page.locator('div.dti-tile-vehicle-lg', { hasText: plateToActivate });
    const setActiveCheckbox = vehicleRow.locator('div[id$="_rgnCheckBox"]');
    await Promise.all([
        // This is the critical change: wait for the server response that explicitly
        // confirms the new plate is selected by checking for the 'dti-checkbox-selected' class in the response body.
        page.waitForResponse(async resp => resp.url().includes('index.aspx') && (await resp.text()).includes('dti-checkbox-selected')),
        setActiveCheckbox.click()
    ]);
    await page.waitForLoadState('networkidle');
    await logScreenshotToClient(page, clientId, 'Screenshot after checking new plate.');

    // Click the final update button
    // This click triggers a POST and a redirect. We'll wait for the navigation to fully complete.
    logToClient(clientId, 'Clicking "Update Permit" to save changes...');
    await Promise.all([
      // Wait for the navigation that follows the click to be completely finished.
      page.locator('input[name*="btnContinue"][value="Update Permit"]').click(),
      page.waitForURL('**/index.aspx', { waitUntil: 'networkidle' })
    ]);

    await logScreenshotToClient(page, clientId, 'Final screenshot of dashboard after update.');

    if (process.env.DEBUG_MODE === 'true') {
      logToClient(clientId, 'Debug mode active. Update complete. No redirect.');
      res.json({ success: true, message: 'Update complete. Debug mode is active.' });
    } else {
      logToClient(clientId, 'Update successful! Redirecting to dashboard...');
      res.json({ success: true, redirectUrl: '/' });
    }

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