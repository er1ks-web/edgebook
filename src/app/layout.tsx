import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Plus_Jakarta_Sans } from "next/font/google";
import { Logo } from "@/components/Logo";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
const logo = Plus_Jakarta_Sans({ subsets: ["latin"], weight: "800", style: "italic", variable: "--font-logo" });

export const metadata: Metadata = {
  title: "Edgebook",
  description: "Private sports picks and parlays, priced against sharp markets and researched with AI.",
};

// Runs before the first paint, so the intro plays once per tab and never flashes after that.
const INTRO_ONCE = `try{if(sessionStorage.getItem("edgebook.intro")){document.documentElement.classList.add("intro-seen")}else{sessionStorage.setItem("edgebook.intro","1")}}catch(e){document.documentElement.classList.add("intro-seen")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${logo.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_ONCE }} />
      </head>
      <body>
        <div className="splash" aria-hidden="true">
          <Logo className="splash-logo" />
        </div>
        {children}
      </body>
    </html>
  );
}
