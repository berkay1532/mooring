import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Manrope } from "next/font/google";
import { GrainOverlay } from "@/components/layout/GrainOverlay";
import { Providers } from "./providers";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Mooring — spending cards for AI agents",
  description:
    "A non-custodial spending card for AI agents on Stellar. Budget, allowlist, and expiry enforced on-chain with every payment.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The `next/font` variables go on <html>: `globals.css` maps
    // `--font-display/body/mono` to them inside `@theme`, which Tailwind emits
    // on `:root` — set on <body>, they would be undefined where they are read,
    // and every font would fall back to the system stack.
    <html lang="en" className={`${instrumentSerif.variable} ${manrope.variable} ${plexMono.variable}`}>
      <body className="bg-bg-deep text-text-lo font-body antialiased">
        <GrainOverlay />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
