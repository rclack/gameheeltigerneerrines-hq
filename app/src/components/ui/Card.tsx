interface CardProps {
  title?: string;
  children: React.ReactNode;
}

export default function Card({ title, children }: CardProps) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-6 shadow-xl">
      {title && (
        <h2 className="mb-4 text-2xl font-bold text-white">
          {title}
        </h2>
      )}

      {children}
    </div>
  );
}
