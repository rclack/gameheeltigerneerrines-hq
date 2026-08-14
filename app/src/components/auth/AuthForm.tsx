"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
  nextPath?: string;
}

function friendlyAuthError(message: string) {
  if (message.includes("Invalid login credentials")) return "Email or password is incorrect.";
  if (message.includes("Email not confirmed")) return "Please confirm your email before signing in.";
  if (message.includes("User already registered")) return "An account already exists for this email.";
  if (message.includes("Password should be")) return "Password does not meet the minimum requirements.";
  if (message.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
  return "Authentication failed. Please try again.";
}

export default function AuthForm({ mode, nextPath = "/commissioner" }: AuthFormProps) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const safeNextPath = nextPath.startsWith("/") && !nextPath.startsWith("//")
    ? nextPath
    : "/commissioner";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = displayName.trim();

    if (isSignup && cleanName.length < 2) {
      setError("Display name must contain at least 2 characters.");
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);
    const supabase = createClient();

    try {
      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { display_name: cleanName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNextPath)}`,
          },
        });
        if (signUpError) throw signUpError;

        if (data.session) {
          router.push(safeNextPath);
          router.refresh();
        } else {
          setMessage("Account created. Check your email to confirm your address, then sign in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) throw signInError;
        router.push(safeNextPath);
        router.refresh();
      }
    } catch (caughtError) {
      const authMessage = caughtError instanceof Error ? caughtError.message : "";
      setError(friendlyAuthError(authMessage));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 to-slate-900 px-4 py-12">
      <div className="w-full max-w-md">
        <Card title={isSignup ? "Create your account" : "Commissioner Login"}>
          <form className="space-y-5" onSubmit={handleSubmit}>
            {isSignup && (
              <label className="block space-y-2 text-sm font-semibold text-slate-300">
                Display name
                <input
                  autoComplete="name"
                  className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </label>
            )}

            <label className="block space-y-2 text-sm font-semibold text-slate-300">
              Email
              <input
                type="email"
                autoComplete="email"
                className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="block space-y-2 text-sm font-semibold text-slate-300">
              Password
              <input
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {isSignup && (
              <label className="block space-y-2 text-sm font-semibold text-slate-300">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
            )}

            {error && <p role="alert" className="rounded-lg bg-red-950/70 p-3 text-sm text-red-200">{error}</p>}
            {message && <p role="status" className="rounded-lg bg-green-950/70 p-3 text-sm text-green-200">{message}</p>}

            <Button type="submit" variant="sports" disabled={isSubmitting}>
              {isSubmitting ? "Please wait…" : isSignup ? "Create Account" : "Sign In"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-300">
            {isSignup ? "Already have an account?" : "Need an account?"}{" "}
            <Link
              className="font-semibold text-blue-400 hover:text-blue-300"
              href={`${isSignup ? "/login" : "/signup"}?next=${encodeURIComponent(safeNextPath)}`}
            >
              {isSignup ? "Sign in" : "Sign up"}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
