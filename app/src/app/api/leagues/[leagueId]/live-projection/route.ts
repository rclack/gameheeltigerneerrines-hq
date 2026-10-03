import { createClient } from "@/lib/supabase/server";
import { getLiveProjection } from "@/services/liveProjectionService";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  if (!UUID.test(leagueId)) return Response.json({ error: "Invalid league identifier." }, { status: 400, headers: PRIVATE_NO_STORE });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Authentication required." }, { status: 401, headers: PRIVATE_NO_STORE });
  const { data: membership, error: membershipError } = await supabase.from("league_members").select("id").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle();
  if (membershipError || !membership) return Response.json({ error: "League not found or access denied." }, { status: 404, headers: PRIVATE_NO_STORE });

  try {
    const projection = await getLiveProjection(supabase, leagueId);
    return Response.json(projection, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    console.error("[live-projection]", { leagueId, error: error instanceof Error ? error.message : "unknown_error" });
    return Response.json({ error: "Live projection is temporarily unavailable." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
