import type { Snapshot, TabNode } from '../shared/protocol';

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True if `token` occurs in `text` at the start or right after a non-alphanumeric char. */
function atWordStart(text: string, token: string): boolean {
  let i = text.indexOf(token);
  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]!)) return true;
    i = text.indexOf(token, i + 1);
  }
  return false;
}

/**
 * Every token must match title or URL (case-insensitive). Higher = better.
 * Per token: title prefix 8, title word start 5, host word start 4, title substring 3,
 * URL substring 1. Returns null if any token fails to match.
 */
export function scoreTab(tab: TabNode, tokens: string[]): number | null {
  const title = tab.title.toLowerCase();
  const url = tab.url.toLowerCase();
  const host = tab.host.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (title.startsWith(tok)) score += 8;
    else if (atWordStart(title, tok)) score += 5;
    else if (atWordStart(host, tok)) score += 4;
    else if (title.includes(tok)) score += 3;
    else if (url.includes(tok)) score += 1;
    else return null;
  }
  return score;
}

/** Flat ranked list: match quality first, then recency. */
export function filterTabs(s: Snapshot, query: string): TabNode[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored: { tab: TabNode; score: number }[] = [];
  for (const w of s.windows) {
    for (const tab of w.tabs) {
      const score = scoreTab(tab, tokens);
      if (score != null) scored.push({ tab, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.tab.lastAccessed - a.tab.lastAccessed);
  return scored.map((x) => x.tab);
}
