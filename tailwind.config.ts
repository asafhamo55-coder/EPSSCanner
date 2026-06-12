import type { Config } from 'tailwindcss'
import sharedConfig from './src/ui/tailwind.config'

const config: Config = {
  ...sharedConfig,
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
}

export default config
