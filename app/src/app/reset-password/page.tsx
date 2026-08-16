import Link from "next/link";

import { updateRecoveredPassword } from "@/app/auth/actions";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/server";

interface ResetPasswordPageProps {
  searchParams: Promise<{ error?: string }>;
}

const FORM_ERRORS: Record<string, string> = {
  length: "Password must be at least 8 characters.",
  mismatch: "Passwords do not match.",
  update: "The password could not be updated. Request a new recovery email and try again.",
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recoveryUnavailable = !user || error === "invalid";

  return (
    <AuthPageFrame eyebrow="Account recovery" title="Choose a new password" introduction="Set a new password, then head back to your league.">
          {recoveryUnavailable ? (
            <div className="space-y-5 text-slate-300">
              <p role="alert" className="rounded-lg bg-amber-950/70 p-4 text-sm leading-6 text-amber-100">
                This password recovery link is invalid, expired, or has already been used.
              </p>
              <Link href="/forgot-password" className="block rounded-lg bg-orange-500 px-4 py-3 text-center font-bold text-white transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                Request a New Recovery Email
              </Link>
            </div>
          ) : (
            <form action={updateRecoveredPassword} className="space-y-5">
              <p className="text-sm leading-6 text-slate-300">
                Enter a new password with at least 8 characters.
              </p>
              <label className="block space-y-2 text-sm font-semibold text-slate-300">
                New password
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={8}
                  className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                  required
                />
              </label>
              <label className="block space-y-2 text-sm font-semibold text-slate-300">
                Confirm new password
                <input
                  type="password"
                  name="passwordConfirmation"
                  autoComplete="new-password"
                  minLength={8}
                  className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                  required
                />
              </label>
              {error && FORM_ERRORS[error] ? (
                <p role="alert" className="rounded-lg bg-red-950/70 p-3 text-sm text-red-200">{FORM_ERRORS[error]}</p>
              ) : null}
              <Button type="submit" variant="sports">Update Password</Button>
            </form>
          )}
    </AuthPageFrame>
  );
}
