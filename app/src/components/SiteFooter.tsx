import Link from "next/link";

const links = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-6 py-5 text-sm text-slate-600">
      <nav aria-label="Site information" className="mx-auto flex max-w-6xl justify-center gap-6">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="transition hover:text-[#0b2b59] hover:underline">
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
