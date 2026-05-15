import { chromium } from 'playwright';
import { config } from './config.js';

async function main(): Promise<void> {
  const context = await chromium.launchPersistentContext(config.browserProfileDir, {
    headless: false,
    viewport: null,
    slowMo: config.slowMoMs,
    args: ['--start-maximized', '--disable-dev-shm-usage']
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(config.chatgptUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.navigationTimeoutMs
  });

  console.log('Browser opened. Log in to ChatGPT manually, then press Ctrl+C here when done.');

  const shutdown = async () => {
    await context.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
