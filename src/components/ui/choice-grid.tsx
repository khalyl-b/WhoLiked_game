"use client";

export function ChoiceGrid<T extends string | number>({ label, values, value, onChange, suffix }: { label: string; values: readonly T[]; value: T; onChange: (value: T) => void; suffix?: string }) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-bold text-zinc-300">{label}</legend>
    <div className="grid grid-cols-4 gap-2">
      {values.map((item) => <button key={item} type="button" onClick={() => onChange(item)} aria-pressed={value === item} className={`focus-ring min-h-12 rounded-xl border px-2 font-bold ${value === item ? "border-cyan-300 bg-cyan-300 text-black" : "border-white/10 bg-white/5 text-white"}`}>{item}{suffix}</button>)}
    </div>
  </fieldset>;
}
