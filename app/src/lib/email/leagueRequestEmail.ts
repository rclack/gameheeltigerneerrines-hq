import { rulesSummary, type RosterRuleInput } from "@/lib/draft/roster-rules";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export interface LeagueRequestEmailInput {
  requesterName: string;
  requesterEmail: string;
  leagueName: string;
  season: string;
  ownerCount: number;
  teamsPerOwner: number;
  rosterRules: RosterRuleInput[];
  approveUrl: string;
  denyUrl: string;
  expiresAt: string;
}

export function buildLeagueRequestEmail(input: LeagueRequestEmailInput) {
  const summary = rulesSummary(input.rosterRules);
  const safeSubjectName = input.leagueName.replace(/[\r\n]+/g, " ").trim();
  const subject = `League approval requested: ${safeSubjectName}`.slice(0, 180);
  const settings = `${input.season} · ${input.ownerCount} owners · ${input.teamsPerOwner} teams per owner`;
  const text = [
    "A new GameHeelTigerNeerRines league requires review.",
    `Requester: ${input.requesterName} <${input.requesterEmail}>`,
    `League: ${input.leagueName}`,
    `Format: ${settings}`,
    `Roster rules: ${summary}`,
    `Review expires: ${input.expiresAt}`,
    `Approve: ${input.approveUrl}`,
    `Deny: ${input.denyUrl}`,
    "The links open a confirmation screen and do not change anything until you submit the decision while signed in as the designated site administrator.",
  ].join("\n\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f1f5f9;color:#0f172a;padding:24px"><main style="max-width:620px;margin:auto;background:white;border-radius:16px;padding:28px"><p style="font-size:12px;font-weight:800;letter-spacing:.16em;color:#c2410c;text-transform:uppercase">League approval</p><h1 style="color:#0b2b59">${escapeHtml(input.leagueName)}</h1><p>A new GameHeelTigerNeerRines league requires review.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Requester</td><td style="padding:8px 0;font-weight:700">${escapeHtml(input.requesterName)} &lt;${escapeHtml(input.requesterEmail)}&gt;</td></tr><tr><td style="padding:8px 0;color:#64748b">Format</td><td style="padding:8px 0;font-weight:700">${escapeHtml(settings)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Roster rules</td><td style="padding:8px 0;font-weight:700">${escapeHtml(summary)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Expires</td><td style="padding:8px 0;font-weight:700">${escapeHtml(input.expiresAt)}</td></tr></table><p style="margin-top:24px"><a href="${escapeHtml(input.approveUrl)}" style="display:inline-block;background:#166534;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:800;margin-right:8px">Review approval</a><a href="${escapeHtml(input.denyUrl)}" style="display:inline-block;background:#991b1b;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:800">Review denial</a></p><p style="font-size:13px;color:#64748b;line-height:1.5">Links are confirmation-only. A decision requires a final submission while signed in as the designated site administrator.</p></main></body></html>`;
  return { subject, html, text };
}
