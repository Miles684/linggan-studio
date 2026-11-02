import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import { CreatorAccountProvider } from "../components/creator-account";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "灵感 Studio · 创作工作台",
  description: "发现热点，收集灵感。为内容工作室打造的抖音、小红书创作工作台。",
  icons: { icon: "/favicon.svg" },
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getChatGPTUser();
  const username = user?.fullName?.trim() || user?.email.split("@")[0] || null;
  return (
    <html lang="zh-CN">
      <body>
        <CreatorAccountProvider username={username}>{children}</CreatorAccountProvider>
      </body>
    </html>
  );
}
