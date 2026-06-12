import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Equity Screener',
    short_name: 'Screener',
    description: 'Fundamental EPS screener.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAFBFD',
    theme_color: '#4F46E5',
    orientation: 'portrait',
    categories: ['finance', 'productivity', 'business'],
  }
}
