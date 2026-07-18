import type { Metadata } from "next";
import "./globals.css";
import { Inter, Merriweather, Archivo, Space_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import Home from "./components/Home";

export const metadata: Metadata = {
  title: "CaseFile",
  description: "AI assisted legal analysis",
  icons: {
    icon: "/scale.svg",
  },
};

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
});

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-merriweather",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-archivo",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full ${spaceMono.variable} ${archivo.variable} ${inter.variable} ${merriweather.variable}`}
    >
      <body className="flex h-full flex-col">
        <Analytics />
        <Home>{children}</Home>
      </body>
    </html>
  );
}
