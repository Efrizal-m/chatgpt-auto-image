import { StopAutomationError } from './errors.js';
import type { ChatGptAutomation } from './chatgptAutomation.js';
import type { EventLogger } from './logger.js';
import type { Notifier } from './notifier.js';
import type { QueueStore } from './store.js';
import type { DoneStatus } from './types.js';

interface WorkerConfig {
  minDelayMs: number;
  maxDelayMs: number;
  doneStatus: DoneStatus;
}

export class WorkerManager {
  private active = false;
  private currentJobId: string | null = null;
  private delayTimer: NodeJS.Timeout | null = null;
  private delayResolve: (() => void) | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly store: QueueStore,
    private readonly automation: ChatGptAutomation,
    private readonly notifier: Notifier,
    private readonly logger: EventLogger
  ) {}

  isActive(): boolean {
    return this.active;
  }

  getCurrentJobId(): string | null {
    return this.currentJobId;
  }

  start(): void {
    if (this.active) return;
    void this.loop();
  }

  async pause(reason = 'manual_pause'): Promise<void> {
    await this.store.setQueueStatus('paused');
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.delayResolve) {
      this.delayResolve();
      this.delayResolve = null;
    }
    await this.logger.log('worker.paused', { reason });
  }

  async resume(): Promise<void> {
    await this.store.setQueueStatus('running');
    await this.logger.log('worker.resumed');
    this.start();
  }

  private async loop(): Promise<void> {
    this.active = true;
    await this.logger.log('worker.started');

    try {
      while (this.store.getQueueStatus() === 'running') {
        const job = this.store.getNextQueuedJob();
        if (!job) break;

        this.currentJobId = job.jobId;
        await this.store.updateJob(job.jobId, {
          status: 'processing',
          startedAt: new Date().toISOString(),
          error: undefined,
          stopReason: undefined
        });
        await this.logger.log('job.processing', { jobId: job.jobId });

        try {
          await this.automation.runImageJob(job.jobId, job.prompt);
          await this.store.updateJob(job.jobId, {
            status: this.config.doneStatus,
            finishedAt: new Date().toISOString()
          });
          await this.logger.log('job.done', { jobId: job.jobId, status: this.config.doneStatus });
        } catch (error) {
          await this.handleJobError(job.jobId, error);
          break;
        } finally {
          this.currentJobId = null;
        }

        if (this.store.getQueueStatus() !== 'running' || !this.store.hasQueuedJobs()) break;

        const delayMs = this.randomInt(this.config.minDelayMs, this.config.maxDelayMs);
        await this.logger.log('worker.delay_before_next_job', { delayMs });
        await this.sleep(delayMs);
      }
    } finally {
      this.active = false;
      this.currentJobId = null;
      await this.logger.log('worker.stopped');
    }
  }

  private async handleJobError(jobId: string, error: unknown): Promise<void> {
    const isStop = error instanceof StopAutomationError;
    const reason = isStop ? error.reason : 'automation_error';
    const message = error instanceof Error ? error.message : String(error);

    await this.store.updateJob(jobId, {
      status: isStop ? 'stopped' : 'failed',
      finishedAt: new Date().toISOString(),
      stopReason: reason,
      error: message
    });
    await this.store.setQueueStatus('paused');
    await this.logger.log('job.stopped_and_queue_paused', { jobId, reason, error: message });
    await this.notifier.notify(`Worker paused for job ${jobId}. Reason: ${reason}. ${message}`);
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.delayResolve = resolve;
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null;
        this.delayResolve = null;
        resolve();
      }, delayMs);
    });
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
