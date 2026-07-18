import type { Metadata } from "next";
import { Geist, Urbanist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

// HYBRID font model (owner ruling 10-22C): Urbanist is the UI typeface
// (--font-sans); Geist stays the numeric face (--font-numeric) because
// Urbanist has NO tabular figures (tnum verified absent, 10-20C gate) while
// Geist's tnum is verified. Every money/aligned-number surface must resolve
// through font-numeric + tabular-nums — never the sans face.
const urbanistSans = Urbanist({
  variable: "--font-urbanist-sans",
  subsets: ["latin", "latin-ext"], // latin-ext: Romanian diacritics (ă â î ș ț)
});
const geistNumeric = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("appName"), description: t("appDescription") };
}

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
      className={`${urbanistSans.variable} ${geistNumeric.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: approved rider (10-22C item 5) for this
          presentation unit — attribute-level only; content mismatches still warn. */}
      <body className="min-h-full" suppressHydrationWarning>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
