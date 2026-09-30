import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paranoia — Celo smart wallet",
  description: "A security-first ERC-4337 wallet on Celo Sepolia.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
