import { getDeploymentProvenance } from "@/lib/deploymentProvenance";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      supabaseConfigured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL
        && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
      cfbdConfigured: Boolean(process.env.CFBD_API_KEY),
      deployment: getDeploymentProvenance(process.env),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
