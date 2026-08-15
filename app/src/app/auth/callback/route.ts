import { NextResponse } from "next/server";

import { safeAuthReturnPath } from "@/lib/auth/redirects";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeAuthReturnPath(url.searchParams.get("next"));
  const redirectOrigin = getSiteOrigin();
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, redirectOrigin));
  } else if (tokenHash && type === "signup") {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) return NextResponse.redirect(new URL(next, redirectOrigin));
  }

  return NextResponse.redirect(new URL("/login?error=confirmation", redirectOrigin));
}
