import fs from 'node:fs/promises';
import path from 'node:path';

export class EventLogger {
  private readonly logPath: string;

  constructor(private readonly dataDir: string) {
    this.logPath = path.join(dataDir, 'events.log');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async log(event: string, meta: Record<string, unknown> = {}): Promise<void> {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...meta
    });

    await fs.appendFile(this.logPath, `${line}\n`, 'utf8');
    console.log(line);
  }
}
