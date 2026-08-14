import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, LeagueInsert } from "@/types/database";

export async function createLeague(
  supabase: SupabaseClient<Database>,
  league: LeagueInsert,
) {
  const { data, error } = await supabase
    .from("leagues")
    .insert(league)
    .select()
    .single();

  if (error) throw error;
  return data;
}
export async function getOwnedLeague(
  supabase: SupabaseClient<Database>,
  commissionerId: string,
) {
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("commissioner_id", commissionerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
