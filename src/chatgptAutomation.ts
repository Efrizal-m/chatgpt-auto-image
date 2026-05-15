import fs from 'node:fs/promises';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { StopAutomationError } from './errors.js';
import type { EventLogger } from './logger.js';

interface AutomationConfig {
  chatgptUrl: string;
  browserProfileDir: string;
  navigationTimeoutMs: number;
  submitEnableTimeoutMs: number;
  generationTimeoutMs: number;
  completionStableMs: number;
  slowMoMs: number;
}

const LIMIT_PATTERNS = [
  /usage cap/i,
  /message cap/i,
  /rate limit/i,
  /too many requests/i,
  /limit reached/i,
  /you'?ve reached/i,
  /try again later/i,
  /temporarily unavailable/i
];

const CAPTCHA_PATTERNS = [/captcha/i, /cf-turnstile/i, /challenge/i];
const HUMAN_VERIFY_PATTERNS = [/verify you are human/i, /human verification/i, /checking your browser/i];
const NETWORK_PATTERNS = [/network error/i, /something went wrong/i, /failed to fetch/i, /connection lost/i];

export class ChatGptAutomation {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private requestFailures = 0;

  constructor(
    private readonly config: AutomationConfig,
    private readonly logger: EventLogger
  ) {}

  async runImageJob(jobId: string, prompt: string): Promise<void> {
    const page = await this.getPage();
    this.requestFailures = 0;

    await this.logger.log('automation.open_chatgpt', { jobId });
    await page.goto(this.config.chatgptUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.navigationTimeoutMs
    });
    await page.waitForLoadState('domcontentloaded', { timeout: this.config.navigationTimeoutMs });
    await this.waitBriefly(1500, 2800);
    await this.assertNoStopCondition(page);

    const input = await this.findPromptInput(page);
    await this.pastePrompt(page, input, prompt);
    await this.assertNoStopCondition(page);

    const submit = await this.waitForSubmitReady(page);
    await this.waitBriefly(400, 1200);
    await submit.click();
    await this.logger.log('automation.submitted', { jobId });

    await this.waitForGenerationToSettle(page, jobId);
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    await fs.mkdir(this.config.browserProfileDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.config.browserProfileDir, {
      headless: false,
      slowMo: this.config.slowMoMs,
      viewport: null,
      args: ['--start-maximized', '--disable-dev-shm-usage']
    });

    this.context.setDefaultTimeout(15_000);
    this.context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.on('requestfailed', (request) => {
      if (request.url().startsWith('https://chatgpt.com')) {
        this.requestFailures += 1;
      }
    });
    return this.page;
  }

  private async findPromptInput(page: Page): Promise<Locator> {
    const candidates = [
      page.getByRole('textbox').last(),
      page.locator('textarea').last(),
      page.locator('[contenteditable="true"]').last()
    ];

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await this.assertNoStopCondition(page);

      for (const candidate of candidates) {
        if ((await candidate.count()) === 0) continue;
        try {
          if (await candidate.isVisible()) {
            await candidate.focus();
            return candidate;
          }
        } catch {
          // The DOM can re-render while ChatGPT initializes; try the next candidate.
        }
      }

      await page.waitForTimeout(500);
    }

    throw new StopAutomationError('automation_error', 'Could not find the ChatGPT prompt input.');
  }

  private async pastePrompt(page: Page, input: Locator, prompt: string): Promise<void> {
    await input.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await this.waitBriefly(250, 700);

    try {
      await page.evaluate(async (text) => {
        await navigator.clipboard.writeText(text);
      }, prompt);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    } catch {
      await page.keyboard.type(prompt, { delay: this.randomInt(8, 24) });
    }

    await this.waitBriefly(700, 1500);
  }

  private async waitForSubmitReady(page: Page): Promise<Locator> {
    const deadline = Date.now() + this.config.submitEnableTimeoutMs;
    let lastSubmit: Locator | null = null;

    while (Date.now() < deadline) {
      await this.assertNoStopCondition(page);
      const submit = await this.findSubmitButton(page);
      if (submit) {
        lastSubmit = submit;
        try {
          if ((await submit.isVisible()) && (await submit.isEnabled())) {
            return submit;
          }
        } catch {
          // Retry after transient UI re-render.
        }
      }
      await page.waitForTimeout(500);
    }

    throw new StopAutomationError(
      lastSubmit ? 'submit_disabled_timeout' : 'submit_unavailable',
      lastSubmit
        ? 'Submit button stayed disabled for too long.'
        : 'Submit button was not found before timeout.'
    );
  }

  private async findSubmitButton(page: Page): Promise<Locator | null> {
    const candidates = [
      page.locator('button[data-testid="send-button"]').last(),
      page.locator('button[aria-label*="Send" i]').last(),
      page.locator('button[aria-label*="Submit" i]').last(),
      page.getByRole('button', { name: /send|submit/i }).last()
    ];

    for (const candidate of candidates) {
      try {
        if ((await candidate.count()) > 0 && (await candidate.isVisible())) {
          return candidate;
        }
      } catch {
        // Continue trying fallbacks.
      }
    }

    return null;
  }

  private async waitForGenerationToSettle(page: Page, jobId: string): Promise<void> {
    const startedAt = Date.now();
    let stableSince: number | null = null;

    while (Date.now() - startedAt < this.config.generationTimeoutMs) {
      await this.assertNoStopCondition(page);

      const busy = await this.isGenerationBusy(page);
      if (busy) {
        stableSince = null;
      } else {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= this.config.completionStableMs) {
          await this.logger.log('automation.generation_settled', { jobId });
          return;
        }
      }

      await page.waitForTimeout(1500);
    }

    throw new StopAutomationError('generation_timeout', 'Generation did not settle before timeout.');
  }

  private async isGenerationBusy(page: Page): Promise<boolean> {
    const stopButtons = [
      page.locator('button[data-testid="stop-button"]').last(),
      page.locator('button[aria-label*="Stop" i]').last(),
      page.getByRole('button', { name: /stop|cancel/i }).last()
    ];

    for (const button of stopButtons) {
      try {
        if ((await button.count()) > 0 && (await button.isVisible())) return true;
      } catch {
        // Try the next signal.
      }
    }

    const bodyText = await this.safeBodyText(page);
    if (/generating|creating|working on|in progress/i.test(bodyText)) return true;

    const submit = await this.findSubmitButton(page);
    if (!submit) return false;
    try {
      return !(await submit.isEnabled());
    } catch {
      return true;
    }
  }

  private async assertNoStopCondition(page: Page): Promise<void> {
    const url = page.url();
    const bodyText = await this.safeBodyText(page);

    if (/\/auth\/login|\/login|\/auth\//i.test(url) || (await this.hasVisibleLogin(page))) {
      throw new StopAutomationError('login_required', 'ChatGPT login is required.');
    }

    if (LIMIT_PATTERNS.some((pattern) => pattern.test(bodyText))) {
      throw new StopAutomationError('limit_detected', 'Limit, rate limit, usage cap, or try-again-later text detected.');
    }

    if (CAPTCHA_PATTERNS.some((pattern) => pattern.test(bodyText))) {
      throw new StopAutomationError('captcha_detected', 'Captcha or browser challenge text detected.');
    }

    if (HUMAN_VERIFY_PATTERNS.some((pattern) => pattern.test(bodyText))) {
      throw new StopAutomationError('human_verification_detected', 'Human verification text detected.');
    }

    if (NETWORK_PATTERNS.some((pattern) => pattern.test(bodyText)) || this.requestFailures >= 8) {
      throw new StopAutomationError('network_error', 'Network error detected in page text or repeated request failures.');
    }
  }

  private async hasVisibleLogin(page: Page): Promise<boolean> {
    const loginButtons = [
      page.getByRole('link', { name: /^log in$/i }).first(),
      page.getByRole('button', { name: /^log in$/i }).first(),
      page.getByRole('button', { name: /continue with/i }).first()
    ];

    for (const locator of loginButtons) {
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible())) return true;
      } catch {
        // Continue.
      }
    }

    return false;
  }

  private async safeBodyText(page: Page): Promise<string> {
    try {
      return await page.locator('body').innerText({ timeout: 2000 });
    } catch {
      return '';
    }
  }

  private async waitBriefly(minMs: number, maxMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.randomInt(minMs, maxMs)));
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
