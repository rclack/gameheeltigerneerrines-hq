import { redirect } from "next/navigation";

import AuthForm from "@/components/auth/AuthForm";
import { safeAuthReturnPath } from "@/lib/auth/redirects";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

interface SignupPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { next } = await searchParams;
  const safeNext = safeAuthReturnPath(next);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(safeNext);

  return <AuthForm mode="signup" nextPath={safeNext} siteOrigin={getSiteOrigin()} />;
}
