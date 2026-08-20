import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TestErsteller",
  description: "Web-Version des WPF-TestErstellers",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body>{children}</body></html>;
}
