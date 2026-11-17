import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Source_Serif_4, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-source-serif',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Pharol — Private Metasearch',
  description:
    'Pharol is a high-performance, privacy-focused metasearch engine with keyless multi-source aggregation, unified synthesis, and zero server retention.',
  openGraph: {
    title: 'Pharol — Private Metasearch',
    description:
      'Pharol is a high-performance, privacy-focused metasearch engine with keyless multi-source aggregation, unified synthesis, and zero server retention.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pharol — Private Metasearch',
    description:
      'Pharol is a high-performance, privacy-focused metasearch engine with keyless multi-source aggregation, unified synthesis, and zero server retention.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${plusJakarta.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title="Pharol"
          href="/opensearch.xml"
        />
      </head>
      <body
        className="min-h-screen font-sans pharol-canvas text-neutral-900 dark:text-neutral-100 antialiased transition-colors duration-150"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
