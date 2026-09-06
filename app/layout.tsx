import type { Metadata, Viewport } from 'next';
import './globals.css'; // Global styles

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export const metadata: Metadata = {
  title: 'AchoVfx Vocal - Real-time Voice, Video & Screen Sharing',
  description: 'High-performance real-time voice and video chat with sequential profile colors, local nicknames, screen share, and crystal clear audio.',
  openGraph: {
    title: 'AchoVfx Vocal - Real-time Voice, Video & Screen Sharing',
    description: 'High-performance real-time voice and video chat with sequential profile colors, local nicknames, screen share, and crystal clear audio.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AchoVfx Vocal - Real-time Voice, Video & Screen Sharing',
    description: 'High-performance real-time voice and video chat with sequential profile colors, local nicknames, screen share, and crystal clear audio.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="fa" dir="rtl" className="h-full">
      <body suppressHydrationWarning className="h-full bg-[#0a0f1d] text-white antialiased touch-manipulation select-none sm:select-auto">
        {children}
      </body>
    </html>
  );
}
