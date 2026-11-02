import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "灵感 Studio · 创作工作台",
  description: "发现热点，收集灵感。为内容工作室打造的抖音、小红书创作工作台。",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
