import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import AuthenticatedAccountMenu from "@/components/auth/AuthenticatedAccountMenu";
import { createClient } from "@/lib/supabase/server";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GameHeelTigerNeerRines HQ",
  description: "College Football Pool",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {user ? <AuthenticatedAccountMenu key={user.id} userId={user.id} email={user.email ?? "Signed-in account"} /> : null}
        {children}
      </body>
    </html>
  );
}
