import type { Metadata } from "next";
import { Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "MediaGrab — Personal Media Manager",
  description:
    "A self-hosted tool for managing and saving your own social media content. Built with Next.js, TypeScript, and FFmpeg.",
  keywords: ["media manager", "self-hosted", "nextjs project", "educational", "portfolio"],
  openGraph: {
    title: "MediaGrab — Personal Media Manager",
    description: "Self-hosted media management tool built with Next.js and TypeScript.",
    type: "website",
  },
  robots: {
    index: false,
    follow: false,
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
