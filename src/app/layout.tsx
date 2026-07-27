import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

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
      className={`${geistNumeric.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: approved rider (10-22C item 5) for this
          presentation unit — attribute-level only; content mismatches still warn. */}
      <body className="min-h-full" suppressHydrationWarning>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
