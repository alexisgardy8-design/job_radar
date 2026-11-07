import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Radar",
  description: "Veille d'offres d'emploi notées selon ton CV",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
