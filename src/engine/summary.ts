import type { PlayerStatus, Session } from './types';

export interface PlayerSummary {
  id: string;
  name: string;
  gamesPlayed: number;
  status: PlayerStatus;
  partners: { name: string; count: number }[];
}

export function summarize(s: Session): PlayerSummary[] {
  const nameById = new Map(s.players.map((p) => [p.id, p.name]));
  return s.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      gamesPlayed: p.gamesPlayed,
      status: p.status,
      partners: Object.entries(p.partnerCounts)
        .flatMap(([id, count]) => {
          const name = nameById.get(id);
          return name ? [{ name, count }] : [];
        })
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function formatSummaryText(s: Session, tzOffsetMinutes = 0): string {
  const date = new Date(s.createdAt + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
  const lines = [`${s.name} — ${date}`, `${plural(s.history.length, 'game')} played`, ''];
  for (const row of summarize(s)) {
    const partners = row.partners.length
      ? ` (${plural(row.partners.length, 'partner')}: ${row.partners
          .map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name))
          .join(', ')})`
      : '';
    lines.push(`${row.name}: ${plural(row.gamesPlayed, 'game')}${partners}`);
  }
  return lines.join('\n');
}
