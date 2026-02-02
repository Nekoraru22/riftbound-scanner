/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        rift: {
          900: '#0a0e17',
          800: '#111827',
          700: '#1a2236',
          600: '#243049',
          500: '#2d3d5c',
          400: '#4a6fa5',
          300: '#7ba4d4',
          200: '#b0cfe8',
          100: '#dbeaf7',
        },
        gold: {
          500: '#c8a84e',
          400: '#d4b96a',
          300: '#e0ca86',
        },
        rune: {
          fury: '#e74c3c',
          order: '#3498db',
          growth: '#2ecc71',
          shadow: '#9b59b6',
          wisdom: '#f39c12',
        },
      },
      fontFamily: {
        display: ['"Cinzel"', 'serif'],
        body: ['"Source Sans 3"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
