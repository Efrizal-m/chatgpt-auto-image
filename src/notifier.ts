import type { EventLogger } from './logger.js';

interface NotifierConfig {
  telegramBotToken: string;
  telegramChatId: string;
  discordWebhookUrl: string;
  notificationPrefix: string;
}

export class Notifier {
  constructor(
    private readonly config: NotifierConfig,
    private readonly logger: EventLogger
  ) {}

  async notify(message: string): Promise<void> {
    const text = `${this.config.notificationPrefix} ${message}`;
    let sent = false;

    if (this.config.telegramBotToken && this.config.telegramChatId) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: this.config.telegramChatId,
              text
            })
          }
        );

        if (!response.ok) {
          throw new Error(`Telegram responded with HTTP ${response.status}`);
        }
        sent = true;
      } catch (error) {
        await this.logger.log('notification.telegram_failed', { error: String(error) });
      }
    }

    if (this.config.discordWebhookUrl) {
      try {
        const response = await fetch(this.config.discordWebhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: text })
        });

        if (!response.ok) {
          throw new Error(`Discord responded with HTTP ${response.status}`);
        }
        sent = true;
      } catch (error) {
        await this.logger.log('notification.discord_failed', { error: String(error) });
      }
    }

    if (!sent) {
      console.log(text);
    }

    await this.logger.log('notification.sent', { sent, message });
  }
}
