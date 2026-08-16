import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export function createCronClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_CRON_SECRET_KEY;
  if (!url || !secretKey?.startsWith("sb_secret_")) {
    throw new Error("Scheduled synchronization is not configured.");
  }
  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}
