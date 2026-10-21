import { createClient } from "@/lib/supabase/server";
import { getLeagueChaosHistory } from "@/services/chaosService";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  if (!UUID.test(leagueId)) return Response.json({ error: "Invalid league identifier." }, { status: 400, headers: PRIVATE_NO_STORE });
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: "Authentication required." }, { status: 401, headers: PRIVATE_NO_STORE });
  const membership = await supabase.from("league_members").select("id").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle();
  if (membership.error || !membership.data) return Response.json({ error: "League not found or access denied." }, { status: 404, headers: PRIVATE_NO_STORE });
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  try { return Response.json(await getLeagueChaosHistory(supabase, leagueId, cursor), { headers: PRIVATE_NO_STORE }); }
  catch (readError) {
    console.error("[chaos-history]", { leagueId, error: readError instanceof Error ? readError.message : "unknown_error" });
    return Response.json({ error: "League Chaos history is temporarily unavailable." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
