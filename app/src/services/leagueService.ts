import { supabase } from "@/lib/supabase";
import { League } from "@/types/league";

export async function createLeague(
  league: League
) {
  const { data, error } = await supabase
    .from("leagues")
    .insert(league)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getLeagues() {
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function getLatestLeague() {
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw error;
  }

  return data;
}