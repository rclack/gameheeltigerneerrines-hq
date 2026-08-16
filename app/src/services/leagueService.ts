import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export async function getCommissionedLeagues(supabase: SupabaseClient<Database>, commissionerId: string) {
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("commissioner_id", commissionerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}
