import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";

// Geist is the single UI typeface (--font-sans) and the numeric companion
// (--font-numeric): it ships tabular figures (tnum), so amounts render even
// on the same family via `tabular-nums`. Variable font → all weights 100–900.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Financial tracker",
  description: "Household and company finances",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Cookie-resolved locale (src/i18n/request.ts); also sets <html lang>.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
