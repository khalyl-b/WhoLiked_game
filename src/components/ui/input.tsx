import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`focus-ring min-h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-base text-white placeholder:text-zinc-500 ${className}`} {...props} />;
}
