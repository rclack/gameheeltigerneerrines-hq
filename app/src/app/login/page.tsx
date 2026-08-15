import { redirect } from "next/navigation";

import AuthForm from "@/components/auth/AuthForm";
import { safeAuthReturnPath } from "@/lib/auth/redirects";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; reset?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, reset } = await searchParams;
  const safeNext = safeAuthReturnPath(next);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(safeNext);

  return (
    <AuthForm
      mode="login"
      nextPath={safeNext}
      siteOrigin={getSiteOrigin()}
      notice={reset === "success" ? "Password updated. Sign in with your new password." : undefined}
    />
  );
}
