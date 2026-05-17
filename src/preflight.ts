import fs from 'node:fs/promises';
import { chromium } from 'playwright';

export interface RuntimePreflightStatus {
  ok: boolean;
  chromium: {
    installed: boolean;
    executablePath: string;
    installCommand?: string;
  };
  display: {
    available: boolean;
    display?: string;
    waylandDisplay?: string;
    message?: string;
  };
}

export async function checkRuntimePreflight(): Promise<RuntimePreflightStatus> {
  const executablePath = chromium.executablePath();
  const chromiumInstalled = await pathExists(executablePath);
  const displayAvailable =
    process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

  return {
    ok: chromiumInstalled && displayAvailable,
    chromium: {
      installed: chromiumInstalled,
      executablePath,
      ...(chromiumInstalled ? {} : { installCommand: 'npx playwright install chromium' })
    },
    display: {
      available: displayAvailable,
      display: process.env.DISPLAY,
      waylandDisplay: process.env.WAYLAND_DISPLAY,
      ...(displayAvailable
        ? {}
        : {
            message:
              'This app launches a visible browser. Run it from a desktop session, configure X11/Wayland for Docker, or use xvfb-run.'
          })
    }
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
