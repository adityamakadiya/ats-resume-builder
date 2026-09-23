import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

/*
  Instrument Serif for display: high contrast, editorial, and it carries the
  large score numeral without looking like a dashboard widget. IBM Plex Sans
  and Mono for everything else. Plex has real drafting-table character, and
  the mono is what makes measured values read as measured.

  shadcn's init grafted Geist on here. It has been removed: two sans faces in
  one document is a mistake, and Geist is the single most over-used typeface
  in generated interfaces.
*/

const display = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const sans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Tailor, resume against one job description",
  description:
    "Rewrites your resume for one posting using only what it already says, and shows you every line it could not trace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only rounded-xs bg-stamp px-3 py-2 text-sm text-paper-raised focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
