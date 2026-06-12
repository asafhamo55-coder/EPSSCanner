// Per-hub design tokens. Apps wire these into CSS variables at the root
// layout so all shared components inherit the correct palette / scale.
//
// HOA Hub: teal/warm, larger base font (Linda is 58, AAA contrast).
// PM Hub: efficient blue.
// Eviction Hub: calm purple, AAA contrast for high-stakes legal copy.

export const tokens = {
  hoa: {
    primary: '#00C9A7',
    primaryFg: '#ffffff',
    accent: '#F59E0B',
    bg: '#F8FFFE',
    surface: '#ffffff',
    border: '#E5F7F4',
    text: '#0F2027',
    muted: '#64748B',
    fontSizeBase: '18px',
  },
  pm: {
    primary: '#3B82F6',
    primaryFg: '#ffffff',
    accent: '#10B981',
    bg: '#F8FAFF',
    surface: '#ffffff',
    border: '#DBEAFE',
    text: '#0F172A',
    muted: '#64748B',
    fontSizeBase: '16px',
  },
  eviction: {
    primary: '#8B5CF6',
    primaryFg: '#ffffff',
    accent: '#F59E0B',
    bg: '#FAFAFF',
    surface: '#ffffff',
    border: '#EDE9FE',
    text: '#0F0A1E',
    muted: '#64748B',
    fontSizeBase: '16px',
  },
  // Equity Screener Hub. Finance UX rule: green=up / red=down are DATA colors,
  // so the brand/primary is a neutral slate-indigo (never directional) and the
  // pos/neg tokens are reserved exclusively for signal chips + chart deltas.
  screener: {
    primary: '#4F46E5',     // slate-indigo — brand chrome only
    primaryFg: '#ffffff',
    accent: '#F59E0B',      // amber — AI affordances (consistent across hubs)
    pos: '#059669',         // emerald-600 — up / pass / accelerating ONLY
    neg: '#E11D48',         // rose-600 — down / fail / decelerating ONLY
    bg: '#FAFBFD',
    surface: '#ffffff',
    border: '#E5E7EB',
    text: '#111827',
    muted: '#6B7280',
    fontSizeBase: '16px',
  },
} as const

export type HubKey = keyof typeof tokens
