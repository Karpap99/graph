import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Гравитационный граф",
  description:
    "Интерактивная симуляция графа с притяжением, векторами и траекториями вершин.",
  openGraph: {
    title: "Гравитационный граф",
    description:
      "Исследуйте связи, притяжение, скорость и ускорение вершин.",
    images: ["/og.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
