import express, { type Request, type Response } from 'express';
import type { EventLogger } from './logger.js';
import type { QueueStore } from './store.js';
import type { WorkerManager } from './worker.js';

interface ServerDeps {
  store: QueueStore;
  worker: WorkerManager;
  logger: EventLogger;
}

export function createServer({ store, worker, logger }: ServerDeps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/enqueue', async (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId.trim() : '';

    if (!prompt || !jobId) {
      res.status(400).json({ error: 'Body must include non-empty string fields: prompt, jobId.' });
      return;
    }

    try {
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

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}
