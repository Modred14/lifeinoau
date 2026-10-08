// app/layout.js
import "./globals.css";
import { Outfit, Work_Sans } from "next/font/google";
import Shell from "@/components/Shell";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const work = Work_Sans({ subsets: ["latin"], variable: "--font-work", display: "swap" });
export const metadata = { title: "lifeinoau", description: "Live your OAU story with real people." };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0d1321" };
export default function RootLayout({ children }) {
  return (<html lang="en" className={`${outfit.variable} ${work.variable}`}><body><Shell>{children}</Shell></body></html>);
}
