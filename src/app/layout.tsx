import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Lufga carries no tabular figures (verified: no tnum, proportional digit
// widths), so amounts keep a tabular-capable font via --font-geist-mono.
const lufga = localFont({
  src: [
    { path: "../fonts/Lufga-Light.otf", weight: "300", style: "normal" },
    { path: "../fonts/Lufga-Regular.otf", weight: "400", style: "normal" },
    { path: "../fonts/Lufga-Medium.otf", weight: "500", style: "normal" },
  ],
  variable: "--font-lufga",
  display: "swap",
});

// Geist Sans is the numeric companion (--font-numeric): Lufga has no tabular
// figures, Geist ships tnum. Geist Mono remains only for legacy font-mono
// amount styling until the component restyle.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Financial tracker",
  description: "Household and company finances",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lufga.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
