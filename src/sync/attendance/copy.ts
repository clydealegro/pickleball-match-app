import { formatRange, type Slot } from '../../store/slots';
import { dateLabel } from '../../member/format';
import { titleFor, weekdayName } from './links';
import type { Summary } from './types';

const compare = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
const sorted = (names: string[]) => [...names].sort(compare);
const withAnswer = (summary: Summary, status: 'in' | 'maybe') =>
  Object.entries(summary.answers)
    .filter(([id, answer]) => answer === status && id in summary.names)
    .map(([id]) => ({ id, name: summary.names[id] }));

/** The attendance list for the group chat. No trailing newline, and Out answers are never listed. */
export function listText(slot: Slot, summary: Summary): string {
  const head = [titleFor(slot), dateLabel(summary.playDate)];
  if (slot.startMin !== undefined || slot.endMin !== undefined) head.push(formatRange(slot.startMin, slot.endMin));
  if (slot.venue?.trim()) head.push(slot.venue.trim());
  const late = new Set(summary.lateIds);
  const inNames = withAnswer(summary, 'in')
    .map((p) => ({ ...p, label: late.has(p.id) ? `${p.name} (late)` : p.name }))
    .sort((a, b) => compare(a.name, b.name));
  const lines = [head.join(', '), `In (${inNames.length})${inNames.length ? `: ${inNames.map((p) => p.label).join(', ')}` : ''}`];
  const maybe = sorted(withAnswer(summary, 'maybe').map((p) => p.name));
  if (maybe.length) lines.push(`Maybe (${maybe.length}): ${maybe.join(', ')}`);
  const friends = sorted(summary.tonight.map((g) => g.name));
  if (friends.length) lines.push(`Friends (${friends.length}): ${friends.join(', ')}`);
  return lines.join('\n');
}

/** A message for the people who answered Maybe, or an empty string when there are none. No link in it. */
export function nudgeText(slot: Slot, summary: Summary): string {
  const names = sorted(withAnswer(summary, 'maybe').map((p) => p.name));
  if (names.length === 0) return '';
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${who}, are you in for ${weekdayName(slot.weekday)}?`;
}
