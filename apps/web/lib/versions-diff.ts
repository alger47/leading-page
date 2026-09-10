/**
 * Version comparison (Phase 9 — J4): metadata + section diff summary between
 * two Page Schema envelopes.
 *
 * Sections are compared by stable `id`:
 *   - 'added'     present in b, absent from a
 *   - 'removed'   present in a, absent from b
 *   - 'unchanged' structurally identical (type, variant, content)
 *   - 'changed'   same id, different type/variant/content; `changedSlots`
 *     lists the differing top-level keys (prefixed `content.` for slot keys)
 *
 * Metadata compares page.title/locale/direction and the theme object. The
 * summary never mutates the envelopes and is safe to render.
 */

export interface SectionDiffEntry {
  id: string;
  type: string;
  action: 'added' | 'removed' | 'unchanged' | 'changed';
  previousPosition: number | null;
  currentPosition: number | null;
  /** Present for 'changed': 'type' | 'variant' | 'content.<slot>'. */
  changedSlots?: string[];
}

export interface MetadataDiff {
  title: { previous: string | null; current: string | null; changed: boolean };
  locale: { previous: string | null; current: string | null; changed: boolean };
  direction: { previous: string | null; current: string | null; changed: boolean };
  theme: { previous: Record<string, unknown> | null; current: Record<string, unknown> | null; changed: boolean };
}

export interface VersionDiffSummary {
  metadata: MetadataDiff;
  sections: SectionDiffEntry[];
  counts: { added: number; removed: number; changed: number; unchanged: number };
}

interface SectionLike {
  id: string;
  type: string;
  variant?: unknown;
  content?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality (JSONB may reorder keys, so not string equality). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((value, i) => deepEqual(value, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function toSections(envelope: unknown): SectionLike[] {
  if (!isRecord(envelope)) return [];
  const sections = envelope.sections;
  if (!Array.isArray(sections)) return [];
  return sections.filter((s): s is SectionLike => isRecord(s) && typeof s.id === 'string' && typeof s.type === 'string');
}

function changedSlotsFor(previous: SectionLike, current: SectionLike): string[] {
  const slots: string[] = [];
  if (!deepEqual(previous.type, current.type)) slots.push('type');
  if (!deepEqual(previous.variant, current.variant)) slots.push('variant');
  const previousContent = previous.content ?? {};
  const currentContent = current.content ?? {};
  const keys = new Set<string>([...Object.keys(previousContent), ...Object.keys(currentContent)]);
  for (const key of keys) {
    if (!deepEqual(previousContent[key], currentContent[key])) slots.push(`content.${key}`);
  }
  return slots;
}

export function diffSections(previousEnvelope: unknown, currentEnvelope: unknown): SectionDiffEntry[] {
  const previous = toSections(previousEnvelope);
  const current = toSections(currentEnvelope);
  const previousById = new Map(previous.map((s, index) => [s.id, { section: s, index }]));
  const currentById = new Map(current.map((s, index) => [s.id, { section: s, index }]));

  const entries: SectionDiffEntry[] = [];
  const ids = new Set<string>([...previousById.keys(), ...currentById.keys()]);

  for (const id of ids) {
    const before = previousById.get(id);
    const after = currentById.get(id);
    if (before && !after) {
      entries.push({ id, type: before.section.type, action: 'removed', previousPosition: before.index, currentPosition: null });
    } else if (!before && after) {
      entries.push({ id, type: after.section.type, action: 'added', previousPosition: null, currentPosition: after.index });
    } else if (before && after) {
      const unchanged = deepEqual(before.section, after.section);
      entries.push({
        id,
        type: after.section.type,
        action: unchanged ? 'unchanged' : 'changed',
        previousPosition: before.index,
        currentPosition: after.index,
        ...(unchanged ? {} : { changedSlots: changedSlotsFor(before.section, after.section) }),
      });
    }
  }
  return entries;
}

export function diffMetadata(previousEnvelope: unknown, currentEnvelope: unknown): MetadataDiff {
  const previous = isRecord(previousEnvelope) ? previousEnvelope : {};
  const current = isRecord(currentEnvelope) ? currentEnvelope : {};
  const previousPage = isRecord(previous.page) ? previous.page : {};
  const currentPage = isRecord(current.page) ? current.page : {};
  const previousTheme = isRecord(previous.theme) ? previous.theme : null;
  const currentTheme = isRecord(current.theme) ? current.theme : null;

  const title = { previous: stringOrNull(previousPage.title), current: stringOrNull(currentPage.title) };
  const locale = { previous: stringOrNull(previousPage.locale), current: stringOrNull(currentPage.locale) };
  const direction = { previous: stringOrNull(previousPage.direction), current: stringOrNull(currentPage.direction) };
  return {
    title: { ...title, changed: !deepEqual(title.previous, title.current) },
    locale: { ...locale, changed: !deepEqual(locale.previous, locale.current) },
    direction: { ...direction, changed: !deepEqual(direction.previous, direction.current) },
    theme: { previous: previousTheme, current: currentTheme, changed: !deepEqual(previousTheme, currentTheme) },
  };
}

export function diffVersions(previousEnvelope: unknown, currentEnvelope: unknown): VersionDiffSummary {
  const metadata = diffMetadata(previousEnvelope, currentEnvelope);
  const sections = diffSections(previousEnvelope, currentEnvelope);
  const counts = {
    added: sections.filter((s) => s.action === 'added').length,
    removed: sections.filter((s) => s.action === 'removed').length,
    changed: sections.filter((s) => s.action === 'changed').length,
    unchanged: sections.filter((s) => s.action === 'unchanged').length,
  };
  return { metadata, sections, counts };
}