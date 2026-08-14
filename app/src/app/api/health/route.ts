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
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
