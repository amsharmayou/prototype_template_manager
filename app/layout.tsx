import type { Metadata } from "next";
import "./globals.css";

import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Bill Template Maker",
  description: "Turn a photo of your paper bill into a fillable digital bill.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-desk font-sans text-ink">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
