import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Who Liked That?",
  description: "Guess your friends from their TikTok likes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
