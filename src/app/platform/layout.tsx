import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | 熱話 HotTalk HK",
    default: "平台熱話",
  },
};

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
