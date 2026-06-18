import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Apps override these CSS vars per hub at the root layout.
        primary: 'hsl(var(--primary))',
        'primary-fg': 'hsl(var(--primary-fg))',
        'primary-soft': 'hsl(var(--primary-soft))',
        secondary: 'hsl(var(--secondary))',
        accent: 'hsl(var(--accent))',
        background: 'hsl(var(--background))',
        surface: 'hsl(var(--surface))',
        border: 'hsl(var(--border))',
        foreground: 'hsl(var(--foreground))',
        'muted': 'hsl(var(--muted))',
        destructive: 'hsl(var(--destructive))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'calc(var(--radius) + 4px)',
        xl: 'calc(var(--radius) + 8px)',
        '2xl': 'calc(var(--radius) + 16px)',
      },
      boxShadow: {
        // Soft, layered, low-opacity shadows for a clean modern light look.
        xs: '0 1px 2px 0 rgb(17 17 34 / 0.05)',
        sm: '0 1px 3px 0 rgb(17 17 34 / 0.06), 0 1px 2px -1px rgb(17 17 34 / 0.04)',
        md: '0 6px 16px -4px rgb(17 17 34 / 0.08), 0 2px 6px -2px rgb(17 17 34 / 0.05)',
        lg: '0 14px 34px -8px rgb(17 17 34 / 0.12), 0 4px 12px -4px rgb(17 17 34 / 0.06)',
        xl: '0 28px 56px -14px rgb(17 17 34 / 0.18), 0 8px 20px -8px rgb(17 17 34 / 0.08)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        shimmer: 'shimmer 1.5s linear infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '.6' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [typography],
}

export default config
