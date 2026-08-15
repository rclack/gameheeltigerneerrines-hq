"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/client";

interface AuthenticatedAccountMenuProps {
  userId: string;
  email: string;
}

function getInitials(email: string) {
  const name = email.split("@", 1)[0] ?? "";
  const parts = name.split(/[._+-]+/).filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase() || "AC";
}

function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      role="menuitem"
      disabled={pending}
      className="w-full rounded-lg bg-red-600 px-3 py-2.5 text-left text-sm font-bold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? "Signing out…" : "Sign Out"}
    </button>
  );
}

export default function AuthenticatedAccountMenu({ userId, email }: AuthenticatedAccountMenuProps) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionIsCurrent, setSessionIsCurrent] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLFormElement>(null);
  const identityRefreshStartedRef = useRef(false);

  useEffect(() => {
    const redirectToLogin = () => {
      setSessionIsCurrent(false);
      window.location.replace("/login");
    };

    const refreshForIdentityChange = () => {
      if (identityRefreshStartedRef.current) return;
      identityRefreshStartedRef.current = true;
      setSessionIsCurrent(false);
      router.refresh();
    };

    const reconcileSession = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();

      if (!user) {
        if (!error || error.name === "AuthSessionMissingError") redirectToLogin();
        return;
      }

      if (user.id !== userId) refreshForIdentityChange();
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        redirectToLogin();
      } else if (session.user.id !== userId) {
        refreshForIdentityChange();
      }
    });

    const handleFocus = () => void reconcileSession();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void reconcileSession();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, supabase, userId]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    signOutRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!sessionIsCurrent) return null;

  return (
    <div ref={containerRef} className="fixed right-3 top-3 z-50 sm:right-5 sm:top-5">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Account menu for ${email}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? "authenticated-account-menu" : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/80 bg-[#0b2b59] text-sm font-black tracking-wide text-white shadow-lg transition hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2"
      >
        {getInitials(email)}
      </button>

      {isOpen ? (
        <div
          id="authenticated-account-menu"
          role="menu"
          aria-label="Account options"
          className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-2xl"
        >
          <div role="presentation">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Signed in as</p>
            <p className="mt-1 truncate text-sm font-semibold" title={email}>{email}</p>
          </div>
          <form ref={signOutRef} action={signOut} role="presentation" className="mt-3 border-t border-slate-200 pt-3">
            <SignOutButton />
          </form>
        </div>
      ) : null}
    </div>
  );
}
