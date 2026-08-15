import Link from "next/link";

interface InfoSection {
  heading: string;
  content: React.ReactNode;
}

interface InfoPageProps {
  eyebrow: string;
  title: string;
  introduction: string;
  sections: InfoSection[];
}

export default function InfoPage({ eyebrow, title, introduction, sections }: InfoPageProps) {
  return (
    <main className="flex-1 bg-slate-100 px-4 py-12 text-slate-900 sm:px-6 sm:py-16">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="bg-gradient-to-br from-[#081f43] via-[#0b2b59] to-blue-800 px-6 py-8 text-white sm:px-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100 sm:text-base">{introduction}</p>
        </header>

        <div className="space-y-8 px-6 py-8 sm:px-10">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-black text-[#0b2b59]">{section.heading}</h2>
              <div className="mt-2 space-y-3 text-sm leading-6 text-slate-700 sm:text-base">
                {section.content}
              </div>
            </section>
          ))}

          <Link href="/" className="inline-flex font-bold text-blue-700 hover:text-blue-900 hover:underline">
            Return to the pool
          </Link>
        </div>
      </article>
    </main>
  );
}
