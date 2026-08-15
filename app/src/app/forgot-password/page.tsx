import Link from "next/link";

import { requestPasswordRecovery } from "@/app/auth/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface ForgotPasswordPageProps {
  searchParams: Promise<{ sent?: string }>;
}

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const { sent } = await searchParams;
  const requestSubmitted = sent === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 to-slate-900 px-4 py-12">
      <div className="w-full max-w-md">
        <Card title="Reset your password">
          {requestSubmitted ? (
            <div className="space-y-5 text-slate-300">
              <p role="status" className="rounded-lg bg-green-950/70 p-4 text-sm leading-6 text-green-200">
                If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.
              </p>
              <p className="text-sm leading-6">
                The link is time-limited. If it expires or has already been used, request another email below.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/forgot-password" className="flex-1 rounded-lg bg-slate-700 px-4 py-2.5 text-center font-semibold text-white transition hover:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                  Request Another
                </Link>
                <Link href="/login" className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-center font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                  Back to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-slate-300">
                Enter your account email. We&apos;ll send password reset instructions if an account exists.
              </p>
              <form action={requestPasswordRecovery} className="space-y-5">
                <label className="block space-y-2 text-sm font-semibold text-slate-300">
                  Email
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                    required
                  />
                </label>
                <Button type="submit" variant="sports">Send Reset Link</Button>
              </form>
              <p className="text-center text-sm text-slate-300">
                Remember your password?{" "}
                <Link href="/login" className="font-semibold text-blue-400 hover:text-blue-300">Sign in</Link>
              </p>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
