"use server";

import { redirect } from "next/navigation";

import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

const RECOVERY_SENT_PATH = "/forgot-password?sent=1";

export async function requestPasswordRecovery(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (email && email.includes("@")) {
    try {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteOrigin()}/auth/recovery/callback`,
      });
    } catch {
      // The response stays identical so provider failures cannot disclose account existence.
    }
  }

  redirect(RECOVERY_SENT_PATH);
}

export async function updateRecoveredPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");

  if (password.length < 8) redirect("/reset-password?error=length");
  if (password !== confirmation) redirect("/reset-password?error=mismatch");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/reset-password?error=invalid");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/reset-password?error=update");

  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?reset=success");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
