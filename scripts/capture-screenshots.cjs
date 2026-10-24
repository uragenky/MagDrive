const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/opencode/bisma/node_modules/playwright');

const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIR = path.resolve(__dirname, '../docs/images');
const PORT = 4179;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    let filePath = path.join(DIST_DIR, reqPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (err) {
      res.writeHead(500);
      res.end('Error loading file');
    }
  });

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Static server running at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const server = await startStaticServer();

  console.log('Launching Playwright Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // High-DPI crisp screenshots
    colorScheme: 'dark',
  });

  const page = await context.newPage();
  const url = `http://127.0.0.1:${PORT}/?demo=1`;

  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. Capture Explorer View (default view)
  console.log('Capturing Explorer View...');
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'magdrive-explorer.png'),
    fullPage: false,
  });

  // 2. Capture Settings View (Tab: Accounts & Storage)
  console.log('Navigating to Settings View...');
  // Click on Settings in the sidebar (aria-label or button with "Settings")
  const settingsBtn = page.locator('button:has-text("Settings")');
  await settingsBtn.click();
  await page.waitForTimeout(1000);

  // Ensure "Accounts & Storage" tab is active
  const storageTab = page.locator('button:has-text("Accounts & Storage")');
  if (await storageTab.count()) {
    await storageTab.click();
    await page.waitForTimeout(500);
  }

  console.log('Capturing Settings - Accounts & Storage Pool View...');
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'magdrive-settings-accounts.png'),
    fullPage: false,
  });

  // 3. Capture Transfers View
  console.log('Navigating to Transfers View...');
  const transfersBtn = page.locator('button:has-text("Transfers")');
  await transfersBtn.click();
  await page.waitForTimeout(1000);

  console.log('Capturing Transfers View...');
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'magdrive-transfers.png'),
    fullPage: false,
  });

  // 4. Capture Health View
  console.log('Navigating to Health View...');
  const healthBtn = page.locator('button:has-text("Health")');
  if (await healthBtn.count()) {
    await healthBtn.click();
    await page.waitForTimeout(1000);
    console.log('Capturing Health View...');
    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'magdrive-health.png'),
      fullPage: false,
    });
  }

  console.log('All screenshots captured successfully!');
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error('Failed to capture screenshots:', err);
  process.exit(1);
});
