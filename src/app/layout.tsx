import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/Providers'
import { Shell } from '@/components/Shell'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Equity Screener',
    template: '%s · Equity Screener',
  },
  description: 'Fundamental EPS screener — track YoY growth, QoQ trend, and forward signals per ticker.',
  applicationName: 'Equity Screener',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Equity Screener' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#4F46E5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint theme script — sets .dark before first paint, no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(!t||t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  )
}
