import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };

export function Button({ className = "", variant = "primary", ...props }: Props) {
  const variantClass = variant === "primary"
    ? "bg-white text-black hover:bg-zinc-200"
    : variant === "danger"
      ? "bg-red-500/15 text-red-200 border border-red-400/30 hover:bg-red-500/25"
      : "bg-white/8 text-white border border-white/10 hover:bg-white/12";
  return <button className={`focus-ring min-h-12 rounded-2xl px-5 py-3 font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${variantClass} ${className}`} {...props} />;
}
