import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** The house voice: a high-contrast old-style serif for lot titles and value. */
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Auctioneer — Live Salerooms for Extraordinary Things",
    template: "%s · Auctioneer",
  },
  description:
    "A live auction house on the web. Real-time bidding, proxy bids, sealed reserves and anti-snipe protection on objects worth staying up for.",
  openGraph: {
    title: "Auctioneer",
    description: "Live salerooms for extraordinary things.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-void text-linen">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
