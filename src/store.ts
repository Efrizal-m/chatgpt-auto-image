import fs from 'node:fs/promises';
import path from 'node:path';
import type { Job, JobStatus, PersistedState, PublicStatus, QueueStatus } from './types.js';

const JOB_STATUSES: JobStatus[] = [
  'queued',
  'processing',
  'completed',
  'manual_review_needed',
  'stopped',
  'failed'
];

export class QueueStore {
  private readonly filePath: string;
  private state: PersistedState = { queueStatus: 'running', jobs: [] };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'jobs.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      this.state = {
        queueStatus: parsed.queueStatus === 'paused' ? 'paused' : 'running',
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
      };

      let changed = false;
      for (const job of this.state.jobs) {
        if (job.status === 'processing') {
          job.status = 'stopped';
          job.updatedAt = new Date().toISOString();
          job.finishedAt = job.updatedAt;
          job.stopReason = 'automation_error';
          job.error = 'Previous process stopped while this job was processing. Manual review is required before resume.';
          this.state.queueStatus = 'paused';
          changed = true;
        }
      }
      if (changed) await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  getQueueStatus(): QueueStatus {
    return this.state.queueStatus;
  }

  async setQueueStatus(status: QueueStatus): Promise<void> {
    this.state.queueStatus = status;
    await this.persist();
  }

  getJobs(): Job[] {
    return [...this.state.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getNextQueuedJob(): Job | undefined {
    return this.state.jobs
      .filter((job) => job.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  }

  hasQueuedJobs(): boolean {
    return this.state.jobs.some((job) => job.status === 'queued');
  }

  async enqueue(jobId: string, prompt: string): Promise<Job> {
    if (this.state.jobs.some((job) => job.jobId === jobId)) {
      throw new Error(`Job already exists: ${jobId}`);
    }

    const now = new Date().toISOString();
    const job: Job = {
      jobId,
      prompt,
      status: 'queued',
      createdAt: now,
      updatedAt: now
    };

    this.state.jobs.push(job);
    await this.persist();
    return job;
  }

  async updateJob(jobId: string, patch: Partial<Job>): Promise<Job> {
    const job = this.state.jobs.find((item) => item.jobId === jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    await this.persist();
    return job;
  }

  async clearCompleted(): Promise<number> {
    const before = this.state.jobs.length;
    this.state.jobs = this.state.jobs.filter(
      (job) => job.status !== 'completed' && job.status !== 'manual_review_needed'
    );
    const removed = before - this.state.jobs.length;
    if (removed > 0) await this.persist();
    return removed;
  }

  publicStatus(workerActive: boolean, currentJobId: string | null): PublicStatus {
    const counts = JOB_STATUSES.reduce<Record<JobStatus, number>>((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as Record<JobStatus, number>);

    for (const job of this.state.jobs) {
      counts[job.status] += 1;
    }

    return {
      queueStatus: this.state.queueStatus,
      workerActive,
      currentJobId,
      counts,
      totalJobs: this.state.jobs.length
    };
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    const tmpPath = `${this.filePath}.tmp`;

    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(tmpPath, payload, 'utf8');
      await fs.rename(tmpPath, this.filePath);
    });

    await this.writeChain;
  }
}
