import type { RunFile } from "./ledger.ts";

/** Публичный «сертификат проверки»: SVG для README + JSON с хешем ledger. */

export type BadgeFile = {
  schema: 1;
  label: string;
  message: string;
  color: string;
  /** Хеш всего ledger на момент генерации. */
  ledger: string;
  runs: number;
  passed: number;
  total: number;
  generatedAt: string;
};

export function badgeColor(passed: number, total: number): string {
  if (total === 0) return "#6e7781";
  const ratio = passed / total;
  if (ratio >= 0.95) return "#1a7f37";
  if (ratio >= 0.8) return "#9a6700";
  return "#cf222e";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Геометрия shields.io: ширина зависит от длины текста. */
export function badgeSvg(label: string, message: string, color: string): string {
  const labelWidth = Math.round(label.length * 6.6) + 12;
  const messageWidth = Math.round(message.length * 6.6) + 12;
  const width = labelWidth + messageWidth;
  const labelCenter = Math.round(labelWidth / 2);
  const messageCenter = labelWidth + Math.round(messageWidth / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(
    label,
  )}: ${escapeXml(message)}">
  <title>${escapeXml(label)}: ${escapeXml(message)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelCenter}" y="14">${escapeXml(label)}</text>
    <text x="${messageCenter}" y="14">${escapeXml(message)}</text>
  </g>
</svg>
`;
}

export function buildBadge(run: RunFile, ledger: { hash: string; runs: number }): BadgeFile {
  // Ручные критерии не влияют на цвет: badge говорит только о машинных проверках.
  const machine = Math.max(run.total - run.skipped, 0);
  const total = machine > 0 ? machine : run.total;
  const passed = run.passed;
  return {
    schema: 1,
    label: "witness",
    message: `${passed}/${total} passing`,
    color: badgeColor(passed, total),
    ledger: ledger.hash,
    runs: ledger.runs,
    passed,
    total,
    generatedAt: new Date().toISOString(),
  };
}

/** Проверка badge: хеш должен совпадать с текущим ledger. */
export function verifyBadge(badge: BadgeFile, ledger: { hash: string }): { ok: boolean; reason?: string } {
  if (badge.schema !== 1) return { ok: false, reason: "неизвестная схема badge" };
  if (!badge.ledger) return { ok: false, reason: "в badge нет хеша ledger" };
  if (badge.ledger !== ledger.hash) {
    return { ok: false, reason: `ledger изменился: в badge ${badge.ledger.slice(0, 12)}, сейчас ${ledger.hash.slice(0, 12)}` };
  }
  return { ok: true };
}
