/**
 * Minimal robots.txt support: User-agent groups, Allow/Disallow with * and $ wildcards,
 * longest match wins (Google's rules). Enough to stay inside what a site allows.
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if ((key === 'allow' || key === 'disallow') && value) current.rules.push({ allow: key === 'allow', pattern: value });
  }
  return groups;
}

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function isAllowed(groups, userAgent, urlString) {
  const url = new URL(urlString);
  const target = url.pathname + url.search;
  const ua = userAgent.toLowerCase();
  const token = ua.split('/')[0];
  const group =
    groups.find((g) => g.agents.some((a) => a !== '*' && (token.includes(a) || a.includes(token)))) ||
    groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (toRegex(r.pattern).test(target)) {
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}
