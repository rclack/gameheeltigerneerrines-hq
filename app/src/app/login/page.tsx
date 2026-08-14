import { redirect } from "next/navigation";

import AuthForm from "@/components/auth/AuthForm";
import { createClient } from "@/lib/supabase/server";

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/commissioner");

  const { next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/commissioner";
  return <AuthForm mode="login" nextPath={safeNext} />;
}
