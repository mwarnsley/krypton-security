/** @type {import("tailwindcss").Config} */
const config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      borderRadius: {
        'krypton-radius-card': '12px',
        'krypton-radius-control': '6px',
        'krypton-radius-full': '9999px',
      },
      colors: {
        'krypton-accent-cyan': '#22d3ee',
        'krypton-alert-rose': '#fb7185',
        'krypton-bg-main': '#020617',
        'krypton-bg-surface': '#0f172a',
        'krypton-border-muted': '#1e293b',
        'krypton-control-active': '#164e63',
        'krypton-control-hover': '#1e3a4a',
        'krypton-danger-foreground': '#fecdd3',
        'krypton-focus-ring': '#67e8f9',
        'krypton-fg-inverse': '#020617',
        'krypton-fg-muted': '#64748b',
        'krypton-fg-primary': '#f8fafc',
        'krypton-fg-secondary': '#cbd5e1',
        'krypton-muted-overlay': '#02061799',
        'krypton-shadow': '#00000066',
        'krypton-spinner-foreground': '#22d3ee',
        'krypton-spinner-track': '#334155',
        'krypton-success': '#6ee7b7',
        'krypton-table-header': '#94a3b8',
        'krypton-table-row-hover': '#172033',
        'krypton-warning-foreground': '#fde68a',
        'krypton-warning-amber': '#fbbf24',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      letterSpacing: {
        'krypton-label': '0.12em',
        'krypton-mono': '0.025em',
      },
      fontSize: {
        'krypton-micro': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: {
        'krypton-space-1': '4px',
        'krypton-space-2': '8px',
        'krypton-space-3': '12px',
        'krypton-space-4': '16px',
        'krypton-space-5': '24px',
        'krypton-space-6': '32px',
      },
    },
  },
  plugins: [],
};

export default config;
