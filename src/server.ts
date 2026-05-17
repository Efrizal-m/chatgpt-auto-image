import express, { type Request, type Response } from 'express';
import type { EventLogger } from './logger.js';
import type { RuntimePreflightStatus } from './preflight.js';
import type { QueueStore } from './store.js';
import type { WorkerManager } from './worker.js';

interface ServerDeps {
  store: QueueStore;
  worker: WorkerManager;
  logger: EventLogger;
  checkRuntimePreflight: () => Promise<RuntimePreflightStatus>;
}

export function createServer({ store, worker, logger, checkRuntimePreflight }: ServerDeps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/enqueue', async (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId.trim() : '';

    if (!prompt || !jobId) {
      res.status(400).json({ error: 'Body must include non-empty string fields: prompt, jobId.' });
      return;
    }

    if (hasUnresolvedN8nExpression(jobId) || hasUnresolvedN8nExpression(prompt)) {
      res.status(400).json({
        error:
          'n8n expression was sent literally. Put the HTTP Request body/value fields in expression mode so jobId and prompt resolve before calling this API.',
        received: { jobId, prompt }
      });
      return;
    }

    try {
      const preflight = await checkRuntimePreflight();
      if (!preflight.ok) {
        await logger.log('api.enqueue_rejected_preflight', { jobId, preflight });
        res.status(503).json({
          error: 'Runtime preflight failed. Fix Playwright Chromium or display setup before enqueueing jobs.',
          preflight
        });
        return;
      }

      const job = await store.enqueue(jobId, prompt);
      await logger.log('api.enqueue', { jobId });
      if (store.getQueueStatus() === 'running') worker.start();
      res.status(202).json({ ok: true, job });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.get('/status', (_req: Request, res: Response) => {
    res.json(store.publicStatus(worker.isActive(), worker.getCurrentJobId()));
  });

  app.post('/pause', async (_req: Request, res: Response) => {
    await worker.pause('manual_pause');
    res.json({ ok: true, queueStatus: store.getQueueStatus() });
  });

  app.post('/resume', async (_req: Request, res: Response) => {
    await worker.resume();
    res.json({ ok: true, queueStatus: store.getQueueStatus() });
  });

  app.get('/jobs', (_req: Request, res: Response) => {
    res.json({ jobs: store.getJobs() });
  });

  app.post('/clear-completed', async (_req: Request, res: Response) => {
    const removed = await store.clearCompleted();
    await logger.log('api.clear_completed', { removed });
    res.json({ ok: true, removed });
  });

  app.get('/health', async (_req: Request, res: Response) => {
    const preflight = await checkRuntimePreflight();
    res.json({ ok: true, preflight });
  });

  return app;
}

function hasUnresolvedN8nExpression(value: string): boolean {
  return /{{\s*\$[^}]+}}/.test(value);
}
