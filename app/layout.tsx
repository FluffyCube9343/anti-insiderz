import "./globals.css";
export const metadata = { title: "Insider-Free Market", description: "ANS-verified prediction market" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
