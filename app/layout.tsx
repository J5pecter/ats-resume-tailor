import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATS Resume Tailor",
  description:
    "Turn your resume into an ATS-optimised, job-description-specific document — without inventing a single thing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
