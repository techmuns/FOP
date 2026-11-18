/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Premium wealth palette (ported FDC kit, re-skinned).
        mun: {
          primary: '#6366F1', // indigo
          'primary-deep': '#4F46E5',
          violet: '#7C3AED',
          emerald: '#10B981', // money / holding value
          'emerald-dark': '#059669',
          amber: '#F59E0B', // cash / OFS taken out
          'amber-dark': '#D97706',
          rose: '#F43F5E', // alert / high pledge
          cyan: '#06B6D4',
          ink: '#0F172A',
          slate: '#334155',
          grey: '#64748B',
          light: '#CBD5E1',
          surface: '#F8FAFC',
          offwhite: '#F1F5F9',
          'offwhite-2': '#E2E8F0',
          'row-odd': '#EEF2FF',
          'row-even': '#F8FAFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)',
        'card-hover': '0 2px 4px rgba(15,23,42,0.06), 0 12px 32px rgba(15,23,42,0.10)',
        pop: '0 8px 28px rgba(15,23,42,0.16)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
