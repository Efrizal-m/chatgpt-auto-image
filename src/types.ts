export type QueueStatus = 'running' | 'paused';

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'manual_review_needed'
  | 'stopped'
  | 'failed';

export type DoneStatus = Extract<JobStatus, 'completed' | 'manual_review_needed'>;

export interface Job {
  jobId: string;
  prompt: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: string;
  error?: string;
}

export interface PersistedState {
  queueStatus: QueueStatus;
  jobs: Job[];
}

export interface PublicStatus {
  queueStatus: QueueStatus;
  workerActive: boolean;
  currentJobId: string | null;
  counts: Record<JobStatus, number>;
  totalJobs: number;
}
