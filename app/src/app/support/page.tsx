import type { Metadata } from "next";

import InfoPage from "@/components/InfoPage";

const SUPPORT_EMAIL = "cfbpooltest@gmail.com";

export const metadata: Metadata = {
  title: "Support | GameHeelTigerNeerRines HQ",
  description: "Get help with the private college football pool beta.",
};

export default function SupportPage() {
  return (
    <InfoPage
      eyebrow="Controlled Beta"
      title="Support"
      introduction="For account help, data or deletion requests, scoring questions, or technical problems, contact the beta administrator."
      sections={[
        {
          heading: "Contact",
          content: (
            <p>
              Email{" "}
              <a className="font-bold text-blue-700 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              . Include the league name and a short description of what happened. For scoring questions, include the game or team involved. Do not send your password or other credentials.
            </p>
          ),
        },
        {
          heading: "What happens next",
          content: (
            <p>
              The site administrator or league commissioner will review the request. During beta there is no guaranteed response time, but account access, privacy, and scoring-integrity issues will be prioritized.
            </p>
          ),
        },
      ]}
    />
  );
}
