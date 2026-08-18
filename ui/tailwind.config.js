/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Widened surface depth: bg→s1 gap is now ~12 lightness points (was 7)
        bg:      '#0A0806',
        s1:      '#1A1410',  // cards — clearly distinct from bg
        s2:      '#231A12',
        s3:      '#2E2016',
        border:  '#2A1E12',
        border2: '#3A2818',
        tx:      '#EDE4D2',
        muted:   '#7A6250',
        muted2:  '#4A3422',
        // Accent reserved for logo + primary CTA only
        accent:  '#C9A23C',  // slightly deeper gold — less amber, more burnished
        // Two-tier semantic: "dim" for informational, full for live-status
        // Use /70 opacity modifier for informational contexts inline
        green:   '#5BBE72',  // slightly more muted than the neon #6ECC84
        red:     '#D45858',
        blue:    '#6AA8C8',
        // Status-only full-saturation variants used explicitly
        'green-live': '#6ECC84',
        'red-live':   '#E06060',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '10px',
      },
      boxShadow: {
        card: '0 2px 12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,220,130,0.04)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,220,130,0.07)',
        'inset-dark': 'inset 0 1px 5px rgba(0,0,0,0.65)',
      },
    },
  },
  plugins: [],
}
