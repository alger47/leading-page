import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Landing AI Studio',
  description: 'Generate multilingual landing pages from a brief.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}