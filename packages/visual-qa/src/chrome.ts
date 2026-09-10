/**
 * System Chrome resolution (Phase 12 — visual-qa).
 *
 * playwright-core ships no browser binary; the checks reuse the locally
 * installed Chrome/Edge. Failing to find one is a *sampling* error (the page
 * simply cannot be rendered), never a rendition failure.
 */

import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA ?? 'C:\\', 'Google\\Chrome\\Application\\chrome.exe'),
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
};

export function resolveChromePath(preferred?: string): string | null {
  if (preferred) return existsSync(preferred) ? preferred : null;
  const list = CANDIDATES[platform()] ?? [];
  for (const candidate of list) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const CHROME_MISSING_HINT =
  'No system Chrome/Edge found. Install a browser or pass --chrome <path> (VQA-ERR-CHROME).';