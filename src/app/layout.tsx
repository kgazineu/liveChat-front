import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "liveChat",
  description: "Real time chat application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#333', // Fundo escuro para combinar com o app
              color: '#fff',      // Texto branco
            },
            success: {
              iconTheme: {
                primary: '#16a34a', // Verde
                secondary: 'white',
              },
            },
            error: {
              iconTheme: {
                primary: '#dc2626', // Vermelho
                secondary: 'white',
              },
            },
          }}
        />
      </body>
    </html>
  );
}
