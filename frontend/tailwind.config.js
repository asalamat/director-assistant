/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Backed by --accent-color (set at runtime from Settings → App Name & Branding)
        // so recoloring the app needs no rebuild. Shades are derived with color-mix.
        accent: {
          DEFAULT: 'var(--accent-color)',
          50:  'color-mix(in srgb, var(--accent-color) 8%, white)',
          100: 'color-mix(in srgb, var(--accent-color) 15%, white)',
          200: 'color-mix(in srgb, var(--accent-color) 30%, white)',
          300: 'color-mix(in srgb, var(--accent-color) 45%, white)',
          400: 'color-mix(in srgb, var(--accent-color) 70%, white)',
          500: 'var(--accent-color)',
          600: 'color-mix(in srgb, var(--accent-color) 88%, black)',
          700: 'color-mix(in srgb, var(--accent-color) 75%, black)',
          800: 'color-mix(in srgb, var(--accent-color) 60%, black)',
          900: 'color-mix(in srgb, var(--accent-color) 45%, black)',
          950: 'color-mix(in srgb, var(--accent-color) 30%, black)',
        },
        sidebar: {
          bg:     '#0f172a',
          hover:  '#1e293b',
          active: '#1e3a5f',
          text:   '#94a3b8',
          'text-active': '#f1f5f9',
          border: '#1e293b',
        },
        surface: {
          DEFAULT: '#ffffff',
          1: '#f8fafc',
          2: '#f1f5f9',
          3: '#e2e8f0',
        },
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        card:       '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-md':  '0 4px 12px 0 rgb(0 0 0 / 0.08)',
        modal:      '0 20px 60px -10px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(0 0 0 / 0.05)',
      },
      animation: {
        'fade-in':  'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
        float:      'float 3s ease-in-out infinite',
        'pulse-dot':'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:  { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        scaleIn:  { from: { transform: 'scale(0.95)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        float:    { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
    },
  },
  plugins: [],
}
