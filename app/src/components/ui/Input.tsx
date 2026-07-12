interface InputProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

export default function Input({
  label,
  placeholder,
  value,
  onChange,
}: InputProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-300">
        {label}
      </label>

      <input
        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-blue-500"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
