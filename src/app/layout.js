// src/app/layout.js
import "./globals.css";
import { Outfit, Work_Sans } from "next/font/google";
import Shell from "@/components/Shell";
import Toaster from "@/components/Toaster";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const work = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work",
  display: "swap",
});

const siteUrl = "https://lifeinoau.com";
const siteName = "lifeinoau";
const description =
  "Live your OAU story with real people. Connect with fellow Obafemi Awolowo University students, share campus life, and discover what's happening around Ile-Ife.";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "lifeinoau | Live your OAU story with real people",
    template: "%s | lifeinoau",
  },
  description,
  applicationName: siteName,
  keywords: [
    "OAU",
    "Obafemi Awolowo University",
    "OAU students",
    "campus life",
    "Ile-Ife",
    "Nigerian university community",
    "lifeinoau",
  ],
  authors: [{ name: siteName, url: siteUrl }],
  creator: siteName,
  publisher: siteName,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName,
    title: "lifeinoau | Live your OAU story with real people",
    description,
    locale: "en_NG",
  },
  twitter: {
    card: "summary_large_image",
    title: "lifeinoau | Live your OAU story with real people",
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1321",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${outfit.variable} ${work.variable}`}>
      <body>
        <Shell>{children}</Shell>
        <Toaster />
      </body>
    </html>
  );
}