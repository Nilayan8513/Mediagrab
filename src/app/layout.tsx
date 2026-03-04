import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "MediaGrab — Social Media Downloader",
  description:
    "Download videos, reels, shorts, and photos from YouTube, Instagram, Twitter/X, and Facebook in the highest quality. Free and fast.",
  keywords: [
    "social media downloader",
    "youtube downloader",
    "instagram downloader",
    "twitter downloader",
    "video downloader",
    "reel downloader",
  ],
  openGraph: {
    title: "MediaGrab — Social Media Downloader",
    description:
      "Download videos, reels, shorts, and photos from YouTube, Instagram, Twitter/X, and Facebook.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
