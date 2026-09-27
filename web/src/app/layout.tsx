import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/providers/AppProviders";
import { SplashScreen } from "@/components/SplashScreen";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SolAgent Pay", template: "%s · SolAgent Pay" },
  description: "USDC invoicing and AI agent payments on Solana.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#0b1121",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {/* Over the app, not around it: the app loads underneath and is ready the moment the splash lifts. */}
        <SplashScreen />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
