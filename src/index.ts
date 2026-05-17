import { config } from './config.js';
import { ChatGptAutomation } from './chatgptAutomation.js';
import { EventLogger } from './logger.js';
import { Notifier } from './notifier.js';
import { checkRuntimePreflight } from './preflight.js';
import { createServer } from './server.js';
import { QueueStore } from './store.js';
import { WorkerManager } from './worker.js';

async function main(): Promise<void> {
  const logger = new EventLogger(config.dataDir);
  await logger.init();

  const store = new QueueStore(config.dataDir);
  await store.init();

  const notifier = new Notifier(config, logger);
  const automation = new ChatGptAutomation(config, logger);
  const worker = new WorkerManager(config, store, automation, notifier, logger);
  const app = createServer({ store, worker, logger, checkRuntimePreflight });

  const preflight = await checkRuntimePreflight();
  if (!preflight.ok) {
    await logger.log('runtime.preflight_failed', { preflight });
    console.warn(
      [
        'Runtime preflight failed. API health/status will still work, but /enqueue will return 503 until fixed.',
        preflight.chromium.installed
          ? undefined
          : `Missing Playwright Chromium. Run: ${preflight.chromium.installCommand}`,
        preflight.display.available ? undefined : preflight.display.message
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  const server = app.listen(config.port, () => {
    void logger.log('server.started', { port: config.port });
  });

  const shutdown = async (signal: string) => {
    await logger.log('server.shutdown', { signal });
    server.close();
    await automation.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (store.getQueueStatus() === 'running' && store.hasQueuedJobs()) {
    worker.start();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
