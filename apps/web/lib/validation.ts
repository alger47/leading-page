/**
 * Input validation (L0 spirit at the API edge + form controls). Nothing below
 * trusts the browser: every field the API accepts is re-validated here.
 */

export const LOCALES = ['ar', 'fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const TONES = [
  'warm-professional',
  'cool-modern',
  'bold-creative',
  'minimal-clean',
  'playful',
  'luxury',
  'bold-minimal',
] as const;

export const EMAIL_MAX = 254;
export const NAME_MAX = 80;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const BRIEF_MIN = 10;
export const BRIEF_MAX = 4_000;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isTone(value: unknown): boolean {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value);
}

export function isEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > EMAIL_MAX) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'email is required';
  if (!isEmail(value.trim())) return 'email is invalid';
  return null;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return 'password is required';
  if (value.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (value.length > PASSWORD_MAX) return `password must be at most ${PASSWORD_MAX} characters`;
  return null;
}

export function validateName(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'name must be a string';
  if (value.length > NAME_MAX) return `name must be at most ${NAME_MAX} characters`;
  return null;
}

export function validateBriefInput(brief: unknown): string | null {
  if (typeof brief !== 'string' || brief.trim() === '') return 'brief is required';
  if (brief.trim().length < BRIEF_MIN) return `brief is too short (min ${BRIEF_MIN} characters)`;
  if (brief.length > BRIEF_MAX) return `brief is too long (max ${BRIEF_MAX} characters)`;
  return null;
}

export function validateTone(tone: unknown): string | null {
  if (typeof tone !== 'string' || tone.trim() === '') return 'tone is required';
  if (!isTone(tone)) return `tone must be one of: ${TONES.join(', ')}`;
  return null;
}

/** Dashboard label for a brief (mirrors the worker's labelFor). */
export function labelForFeedback(brief: string): string {
  const firstLine = brief.split('\n')[0]?.trim() ?? '';
  const snippet = firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
  return snippet || '(empty brief)';
}