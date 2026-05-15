import path from 'node:path';
import dotenv from 'dotenv';
import type { DoneStatus } from './types.js';

dotenv.config();

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function doneStatusFromEnv(): DoneStatus {
  const raw = process.env.JOB_DONE_STATUS ?? 'manual_review_needed';
  if (raw === 'completed' || raw === 'manual_review_needed') return raw;
  throw new Error('JOB_DONE_STATUS must be "completed" or "manual_review_needed"');
}

const minDelaySeconds = numberFromEnv('MIN_DELAY_SECONDS', 60);
const maxDelaySeconds = numberFromEnv('MAX_DELAY_SECONDS', 300);

if (minDelaySeconds < 0 || maxDelaySeconds < 0 || maxDelaySeconds < minDelaySeconds) {
  throw new Error('MIN_DELAY_SECONDS and MAX_DELAY_SECONDS must be non-negative, and max must be >= min');
}

export const config = {
  port: numberFromEnv('PORT', 3000),
  chatgptUrl: process.env.CHATGPT_URL ?? 'https://chatgpt.com/',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  browserProfileDir: path.resolve(process.env.BROWSER_PROFILE_DIR ?? './browser-profile'),
  minDelayMs: minDelaySeconds * 1000,
  maxDelayMs: maxDelaySeconds * 1000,
  generationTimeoutMs: numberFromEnv('GENERATION_TIMEOUT_MS', 15 * 60 * 1000),
  submitEnableTimeoutMs: numberFromEnv('SUBMIT_ENABLE_TIMEOUT_MS', 30 * 1000),
  completionStableMs: numberFromEnv('COMPLETION_STABLE_MS', 45 * 1000),
  navigationTimeoutMs: numberFromEnv('NAVIGATION_TIMEOUT_MS', 60 * 1000),
  slowMoMs: numberFromEnv('SLOW_MO_MS', 50),
  doneStatus: doneStatusFromEnv(),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
  notificationPrefix: process.env.NOTIFICATION_PREFIX ?? '[chatgpt-auto-image]'
} as const;
