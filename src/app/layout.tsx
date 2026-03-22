import type { Metadata } from "next";
import { Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "MediaGrab — Download from Any Platform",
  description:
    "Download videos, reels, and photos from Instagram, Twitter/X, and Facebook. Free, fast, and private.",
  keywords: ["social media downloader", "instagram downloader", "twitter downloader", "facebook downloader"],
  openGraph: {
    title: "MediaGrab — Download from Any Platform",
    description: "Download videos, reels, and photos from Instagram, Twitter/X, and Facebook.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sora.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
