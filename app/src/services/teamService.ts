import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export async function getActiveTeams(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .eq("active", true)
    .order("school_name");
  if (error) throw error;
  return data;
}
