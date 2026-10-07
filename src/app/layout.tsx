import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";

const appSans = Noto_Sans({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

const appMono = Geist_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LiveChat",
  description: "Comunidades, mensagens e chamadas em tempo real.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${appSans.variable} ${appMono.variable} antialiased`}
      >
        {children}
        
        <Toaster 
          position="bottom-center"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#111214',
              color: '#dbdee1',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              fontSize: '14px',
              fontWeight: 500,
            },
            success: {
              iconTheme: {
                primary: '#23a55a',
                secondary: 'white',
              },
            },
            error: {
              iconTheme: {
                primary: '#f23f43',
                secondary: 'white',
              },
            },
          }}
        />
      </body>
    </html>
  );
}
