import type { Metadata } from "next";

import InfoPage from "@/components/InfoPage";

const SUPPORT_EMAIL = "cfbpooltest@gmail.com";

export const metadata: Metadata = {
  title: "Terms | GameHeelTigerNeerRines HQ",
  description: "Simple terms for participating in the private college football pool beta.",
};

export default function TermsPage() {
  return (
    <InfoPage
      eyebrow="Controlled Beta"
      title="Terms"
      introduction="By using this private beta, you agree to use it cooperatively as part of your invited college football pool."
      sections={[
        {
          heading: "Acceptable use",
          content: (
            <p>
              Use your own account, keep access links and credentials private, and do not disrupt the site, probe other participants&apos; information, automate abusive traffic, or use the pool for unlawful activity. Access may be limited or removed when necessary to protect the league or application.
            </p>
          ),
        },
        {
          heading: "Beta availability",
          content: (
            <p>
              The site is provided for a small-group beta and may experience interruptions, mistakes, or changes. No promise is made that it will always be available or error-free. Please report problems so they can be reviewed.
            </p>
          ),
        },
        {
          heading: "League administration and corrections",
          content: (
            <p>
              The league commissioner administers invitations, membership, drafts, games, and scoring for the league. The commissioner may correct schedules, results, team mappings, scoring events, or standings when source data or pool records are incomplete or wrong. The application keeps correction and void history where supported.
            </p>
          ),
        },
        {
          heading: "Third-party college-football data",
          content: (
            <p>
              Schedules, rankings, scores, and team information may come from CFBD or other third-party sources. That information can be delayed, incomplete, or corrected later, and the commissioner&apos;s reviewed league record controls pool administration.
            </p>
          ),
        },
        {
          heading: "Questions",
          content: (
            <p>
              For a terms question or concern, email{" "}
              <a className="font-bold text-blue-700 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
