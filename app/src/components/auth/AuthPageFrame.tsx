import Link from "next/link";

interface AuthPageFrameProps {
  eyebrow: string;
  title: string;
  introduction: string;
  children: React.ReactNode;
  maxWidth?: "md" | "lg";
}

export default function AuthPageFrame({ eyebrow, title, introduction, children, maxWidth = "md" }: AuthPageFrameProps) {
  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-[#061a38] px-4 py-12 text-white sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(249,115,22,0.2),transparent_28%),radial-gradient(circle_at_85%_75%,rgba(37,99,235,0.28),transparent_34%)]" />
      <div className={`relative w-full ${maxWidth === "lg" ? "max-w-lg" : "max-w-md"}`}>
        <Link href="/" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-black text-blue-100 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-sm text-slate-950" aria-hidden="true">GH</span>
          GameHeelTigerNeerRines
        </Link>
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/85 shadow-2xl shadow-black/30 backdrop-blur" aria-labelledby="auth-page-title">
          <header className="border-b border-white/10 bg-blue-950/60 px-5 py-6 sm:px-7">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">{eyebrow}</p>
            <h1 id="auth-page-title" className="mt-2 text-3xl font-black tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-blue-100">{introduction}</p>
          </header>
          <div className="px-5 py-6 sm:px-7">{children}</div>
        </section>
      </div>
    </main>
  );
}
