import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRC業務支援アプリ（PoC）",
  description:
    "病院と治験を指定して業務手順を質問し、根拠となる文書の該当箇所とともに回答を得る",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
