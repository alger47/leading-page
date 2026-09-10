/**
 * Reading the engine's brief-analysis signal back out of job events.
 *
 * The worker relays the (small) brief-analyzer payload as the `detail` of the
 * `stage.brief_analyzed` event; both the server view (page detail) and the
 * client (generation view) use these pure helpers to decide when to warn the
 * user that the generated content is intentionally generic.
 */

export interface BriefAnalysis {
  vertical?: string;
  audience?: string;
  tone?: string;
  intent?: string;
  signals?: string[];
  summary?: string;
  has_enough_facts?: boolean;
}

export interface EventLike {
  type: string;
  at?: string;
  detail?: string;
}

const BRIEF_ANALYZED_EVENT = 'stage.brief_analyzed';

/** Parse the first brief-analysis payload found in job events, or null. */
export function extractBriefAnalysis(events: EventLike[] | null | undefined): BriefAnalysis | null {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (event.type !== BRIEF_ANALYZED_EVENT || typeof event.detail !== 'string') continue;
    try {
      const parsed = JSON.parse(event.detail) as Partial<BriefAnalysis>;
      if (parsed && typeof parsed === 'object' && 'has_enough_facts' in parsed) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

/** True only when a completed analysis explicitly flags the brief as thin. */
export function isIncompleteBrief(events: EventLike[] | null | undefined): boolean {
  return extractBriefAnalysis(events)?.has_enough_facts === false;
}