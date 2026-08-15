import type { Metadata } from "next";

import InfoPage from "@/components/InfoPage";

const SUPPORT_EMAIL = "cfbpooltest@gmail.com";

export const metadata: Metadata = {
  title: "Privacy | GameHeelTigerNeerRines HQ",
  description: "How the college football pool uses and protects participant information.",
};

export default function PrivacyPage() {
  return (
    <InfoPage
      eyebrow="Controlled Beta"
      title="Privacy"
      introduction="This is a private, small-group college football pool. We collect only the information needed to run accounts, leagues, drafts, and scoring."
      sections={[
        {
          heading: "Information we store",
          content: (
            <p>
              We store your account email address and account identifiers; league membership and role; owner or team names you provide; invitations, draft selections, and private draft-queue choices; and game, scoring, standings, and audit history connected with league participation. We may also keep limited operational records needed to diagnose synchronization or application problems.
            </p>
          ),
        },
        {
          heading: "How it is used",
          content: (
            <p>
              We use this information to sign you in, deliver invitations and account messages, operate your league and draft, calculate scores and standings, preserve correction history, and help resolve account or technical issues. We do not use it for advertising or sell it.
            </p>
          ),
        },
        {
          heading: "Services involved",
          content: (
            <p>
              Supabase provides authentication and database services. Vercel hosts the application. Resend delivers league invitation emails. CollegeFootballData.com (CFBD) supplies college-football schedules, scores, rankings, and related team data. Each provider processes the information needed to perform its role.
            </p>
          ),
        },
        {
          heading: "Account and data requests",
          content: (
            <p>
              For account help, questions about your information, or a deletion request, email{" "}
              <a className="font-bold text-blue-700 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              . Some league and scoring records may need to be retained or anonymized to protect the integrity and audit history of a shared league. We will explain what can be deleted or changed.
            </p>
          ),
        },
      ]}
    />
  );
}
