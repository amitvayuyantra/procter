import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AI Interview Proctor", description: "AI-assisted integrity checks for remote interviews" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
