import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: "TRACER — CS2 Performance Lab",
  description: "CS2 demolarını harita, pozisyon, aim, utility ve round bağlamında analiz eden yerel AI koçu.",
  openGraph: {
    title: "TRACER — CS2 Performance Lab",
    description: "Maçını yükle. Tekrarlanan hataları round ve harita kanıtlarıyla gör.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "TRACER CS2 Performance Lab" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TRACER — CS2 Performance Lab",
    description: "CS2 performansını demo verisi ve yerel AI ile analiz et.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
