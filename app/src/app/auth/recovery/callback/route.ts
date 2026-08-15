import { NextResponse } from "next/server";

import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/i;

function recoveryRedirect(path: string) {
  const response = NextResponse.redirect(new URL(path, getSiteOrigin()));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || !TOKEN_HASH_PATTERN.test(tokenHash) || type !== "recovery") {
    return recoveryRedirect("/reset-password?error=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });

  if (error) return recoveryRedirect("/reset-password?error=invalid");
  return recoveryRedirect("/reset-password");
}
