import "server-only";

export interface LeagueInvitationEmailInput {
  commissionerName: string;
  expiresAt: string;
  invitationUrl: string;
  leagueName: string;
  season: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatExpiration(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    timeZone: "America/New_York",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function buildLeagueInvitationEmail(input: LeagueInvitationEmailInput) {
  const commissionerName = escapeHtml(input.commissionerName);
  const expiration = formatExpiration(input.expiresAt);
  const invitationUrl = escapeHtml(input.invitationUrl);
  const leagueName = escapeHtml(input.leagueName);
  const season = escapeHtml(input.season);

  const subject = `Join ${input.leagueName} for the ${input.season} season`.replaceAll(/[\r\n]+/g, " ");
  const text = [
    `You're invited to join ${input.leagueName}.`,
    "",
    `${input.commissionerName}, the league commissioner, invited you to compete in the ${input.season} college football season on GameHeelTigerNeerRines HQ.`,
    "",
    `Join League: ${input.invitationUrl}`,
    "",
    `This invitation expires ${expiration}.`,
    "If you were not expecting this invitation, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#e2e8f0;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${commissionerName} invited you to join ${leagueName}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#e2e8f0;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.16);">
            <tr>
              <td style="background:#061a38;padding:28px 32px;border-bottom:4px solid #f97316;">
                <div style="color:#fdba74;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Commissioner HQ</div>
                <div style="margin-top:8px;color:#ffffff;font-size:28px;font-weight:800;line-height:1.2;">You’ve been called up</div>
                <div style="margin-top:8px;color:#bfdbfe;font-size:15px;line-height:1.5;">Your college football league invitation is ready.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <div style="color:#64748b;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${season} Season</div>
                <h1 style="margin:8px 0 16px;color:#0b2b59;font-size:30px;line-height:1.2;">${leagueName}</h1>
                <p style="margin:0;color:#334155;font-size:16px;line-height:1.7;"><strong>${commissionerName}</strong>, the league commissioner, invited you to join the roster and compete this season.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;background:#f1f5f9;border-left:4px solid #0b2b59;border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;color:#475569;font-size:14px;line-height:1.5;">
                      <strong style="color:#0f172a;">Invitation deadline</strong><br>
                      ${escapeHtml(expiration)}
                    </td>
                  </tr>
                </table>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:28px auto;">
                  <tr>
                    <td align="center" bgcolor="#f97316" style="border-radius:10px;">
                      <a href="${invitationUrl}" style="display:inline-block;padding:15px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;">Join League</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this secure link into your browser:</p>
                <p style="margin:8px 0 0;word-break:break-all;color:#1d4ed8;font-size:13px;line-height:1.6;"><a href="${invitationUrl}" style="color:#1d4ed8;">${invitationUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 32px;color:#64748b;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;">GameHeelTigerNeerRines HQ · College Football League Operations<br>If you were not expecting this invitation, you can safely ignore this email.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, subject, text };
}
