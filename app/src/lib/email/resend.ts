import "server-only";

import {
  buildLeagueInvitationEmail,
  type LeagueInvitationEmailInput,
} from "@/lib/email/leagueInvitationEmail";
import { buildLeagueRequestEmail, type LeagueRequestEmailInput } from "@/lib/email/leagueRequestEmail";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const INVITATION_FROM = "GameHeelTigerNeerRines HQ <invites@gameheeltigerneerrines.com>";
const RECAP_FROM = INVITATION_FROM;
const LEAGUE_APPROVAL_TO = "cfbpooltest@gmail.com";

interface SendLeagueInvitationInput extends LeagueInvitationEmailInput {
  invitationId: string;
  to: string;
}

export class InvitationEmailDeliveryError extends Error {
  constructor() {
    super("League invitation email delivery failed");
    this.name = "InvitationEmailDeliveryError";
  }
}

export async function sendLeagueInvitationEmail(input: SendLeagueInvitationInput) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new InvitationEmailDeliveryError();

  const email = buildLeagueInvitationEmail(input);
  let response: Response;

  try {
    response = await fetch(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `league-invitation/${input.invitationId}/v1`,
      },
      body: JSON.stringify({
        from: INVITATION_FROM,
        to: [input.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new InvitationEmailDeliveryError();
  }

  if (!response.ok) throw new InvitationEmailDeliveryError();

  const result: unknown = await response.json().catch(() => null);
  if (
    typeof result !== "object"
    || result === null
    || !("id" in result)
    || typeof result.id !== "string"
  ) {
    throw new InvitationEmailDeliveryError();
  }
}

export async function sendLeagueRequestApprovalEmail(input: LeagueRequestEmailInput & { requestId: string; notificationVersion: number }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new InvitationEmailDeliveryError();
  const email = buildLeagueRequestEmail(input);
  let response: Response;
  try {
    response = await fetch(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `league-request/${input.requestId}/review/v${input.notificationVersion}`,
      },
      body: JSON.stringify({ from: INVITATION_FROM, to: [LEAGUE_APPROVAL_TO], subject: email.subject, html: email.html, text: email.text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new InvitationEmailDeliveryError(); }
  if (!response.ok) throw new InvitationEmailDeliveryError();
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") throw new InvitationEmailDeliveryError();
}

export async function sendSundayRecapEmail(input: { recapId: string; memberId: string; to: string; subject: string; html: string; text: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new InvitationEmailDeliveryError();
  let response: Response;
  try {
    response = await fetch(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `sunday-recap/${input.recapId}/${input.memberId}/v1` },
      body: JSON.stringify({ from: RECAP_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new InvitationEmailDeliveryError(); }
  if (!response.ok) throw new InvitationEmailDeliveryError();
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") throw new InvitationEmailDeliveryError();
  return result.id;
}
