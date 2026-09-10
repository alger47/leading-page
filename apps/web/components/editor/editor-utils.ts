/**
 * Immutable-ish helpers for editing a Page Schema draft. Edits are local to
 * the browser; nothing is trusted until the server validates (L1/L2) on save.
 * Every mutator returns a NEW document object so the editor can diff at render.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Path = readonly (string | number)[];

export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** New draft from the payload returned by a completed generation/regen. */
export function draftFromContent(content: unknown): Record<string, unknown> {
  return isObject(content) ? cloneJson(content) : {};
}

/** Set value at path, returning a new document. */
export function setAt(doc: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next: unknown = Array.isArray(doc)
    ? (doc as unknown[]).slice()
    : isObject(doc)
      ? { ...doc }
      : Array.isArray(doc)
        ? []
        : {};
  if (Array.isArray(next) && typeof head === 'number') {
    next[head] = setAt(next[head], rest, value);
  } else if (isObject(next)) {
    next[String(head)] = setAt(next[String(head)], rest, value);
  }
  return next;
}

/** Remove the key/index at path, returning a new document. */
export function removeAt(doc: unknown, path: Path): unknown {
  if (path.length === 0) return doc;
  const parent = cloneJson(doc) as { [key: string]: unknown };
  const last = path[path.length - 1];
  const cursor: unknown = parent;
  let holder: { [key: string]: unknown } | unknown[] | null = null;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const cur = holder === null ? cursor : holder;
    if (Array.isArray(cur)) {
      holder = cur[Number(key)] as { [key: string]: unknown };
    } else if (isObject(cur)) {
      holder = cur[String(key)] as { [key: string]: unknown };
    }
    if (holder === undefined) return doc;
  }
  const target = holder ?? parent;
  if (Array.isArray(target)) {
    (target as unknown[]).splice(Number(last), 1);
  } else if (isObject(target)) {
    delete target[String(last)];
  }
  return parent;
}

/** Move an array element from → to, returning a new document. */
export function moveInArray(doc: unknown, path: Path, from: number, to: number): unknown {
  const next = cloneJson(doc) as { [key: string]: unknown };
  let cursor: unknown = next;
  for (const key of path) {
    cursor = (cursor as { [key: string]: unknown })[String(key)];
  }
  if (!Array.isArray(cursor)) return doc;
  const arr = cursor as unknown[];
  const clampedTo = Math.min(Math.max(to, 0), arr.length - 1);
  if (from === clampedTo) return doc;
  const [item] = arr.splice(from, 1);
  arr.splice(clampedTo, 0, item);
  return next;
}

/** A blank value for a freshly added list item. */
export function blankFor(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (isObject(value)) {
    const blank: { [key: string]: unknown } = {};
    for (const [k, v] of Object.entries(value)) blank[k] = blankFor(v);
    return blank;
  }
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return null;
}

/** Human label for a section type (kept tiny; unknown types pass through). */
export const SECTION_TYPE_LABELS: Record<string, string> = {
  header: 'Header',
  hero: 'Hero',
  features: 'Features',
  services: 'Services',
  testimonials: 'Testimonials',
  pricing: 'Pricing',
  faq: 'FAQ',
  stats: 'Stats',
  logos: 'Logos',
  gallery: 'Gallery',
  about: 'About',
  team: 'Team',
  contact: 'Contact',
  cta: 'CTA',
  footer: 'Footer',
};

export function sectionTypeLabel(type: unknown): string {
  return typeof type === 'string' ? (SECTION_TYPE_LABELS[type] ?? type) : 'Section';
}