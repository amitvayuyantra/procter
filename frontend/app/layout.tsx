import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AI Proctor", description: "AI-assisted online exam proctoring" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
