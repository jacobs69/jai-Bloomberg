import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "MARKETFORGE · India Market Terminal",
  description: "MARKETFORGE Bloomberg-style financial terminal for NSE, BSE, HDS shareholders, IPOs, CubePlus, and real-time market news",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
