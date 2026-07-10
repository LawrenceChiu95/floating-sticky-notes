import type { Config } from 'tailwindcss';

export default {
  content: ['./renderer/index.html', './renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Segoe UI', 'Microsoft YaHei UI', 'system-ui', 'sans-serif']
      },
      colors: {
        paper: {
          yellow: '#FFF3B0',
          green: '#DDF7D0',
          blue: '#D8ECFF',
          pink: '#FFDCE8',
          white: '#FAFAF7'
        },
        noteText: '#2B2A27',
        noteMuted: '#6F6A60'
      }
    }
  },
  plugins: []
} satisfies Config;
