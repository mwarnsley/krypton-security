/** @type {import("tailwindcss").Config} */
const config = {
  content: {
    relative: true,
    files: [
      './app/**/*.{js,ts,jsx,tsx,mdx}',
      './components/**/*.{js,ts,jsx,tsx,mdx}',
      './utils/**/*.{js,ts,jsx,tsx,mdx}',
    ],
  },
  theme: {
    extend: {
      animation: {
        'krypton-drawer-in': 'krypton-drawer-in 240ms ease-out',
        'krypton-drawer-out': 'krypton-drawer-out 200ms ease-in',
        'krypton-overlay-in': 'krypton-overlay-in 200ms ease-out',
        'krypton-overlay-out': 'krypton-overlay-out 160ms ease-in',
      },
      borderRadius: {
        'krypton-radius-card': '12px',
        'krypton-radius-control': '6px',
        'krypton-radius-full': '9999px',
      },
      colors: {
        'krypton-severity-medium': 'rgb(var(--krypton-severity-medium) / <alpha-value>)',
        'krypton-severity-low': 'rgb(var(--krypton-severity-low) / <alpha-value>)',
        'krypton-accent-blue': 'rgb(var(--krypton-accent-blue) / <alpha-value>)',
        'krypton-accent-cyan': 'rgb(var(--krypton-accent-cyan) / <alpha-value>)',
        'krypton-accent-violet': 'rgb(var(--krypton-accent-violet) / <alpha-value>)',
        'krypton-alert-rose': 'rgb(var(--krypton-alert-rose) / <alpha-value>)',
        'krypton-bg-main': 'rgb(var(--krypton-bg-main) / <alpha-value>)',
        'krypton-bg-surface': 'rgb(var(--krypton-bg-surface) / <alpha-value>)',
        'krypton-border-muted': 'rgb(var(--krypton-border-muted) / <alpha-value>)',
        'krypton-control-border': 'rgb(var(--krypton-control-border) / <alpha-value>)',
        'krypton-control-active': 'rgb(var(--krypton-control-active) / <alpha-value>)',
        'krypton-control-hover': 'rgb(var(--krypton-control-hover) / <alpha-value>)',
        'krypton-danger-foreground': 'rgb(var(--krypton-danger-foreground) / <alpha-value>)',
        'krypton-focus-ring': 'rgb(var(--krypton-focus-ring) / <alpha-value>)',
        'krypton-fg-inverse': 'rgb(var(--krypton-fg-inverse) / <alpha-value>)',
        'krypton-fg-body': 'rgb(var(--krypton-fg-body) / <alpha-value>)',
        'krypton-fg-muted': 'rgb(var(--krypton-fg-muted) / <alpha-value>)',
        'krypton-fg-primary': 'rgb(var(--krypton-fg-primary) / <alpha-value>)',
        'krypton-fg-secondary': 'rgb(var(--krypton-fg-secondary) / <alpha-value>)',
        'krypton-spinner-foreground': 'rgb(var(--krypton-spinner-foreground) / <alpha-value>)',
        'krypton-spinner-track': 'rgb(var(--krypton-spinner-track) / <alpha-value>)',
        'krypton-success': 'rgb(var(--krypton-success) / <alpha-value>)',
        'krypton-table-header': 'rgb(var(--krypton-table-header) / <alpha-value>)',
        'krypton-table-row-hover': 'rgb(var(--krypton-table-row-hover) / <alpha-value>)',
        'krypton-warning-foreground': 'rgb(var(--krypton-warning-foreground) / <alpha-value>)',
        'krypton-warning-amber': 'rgb(var(--krypton-warning-amber) / <alpha-value>)',
        'krypton-muted-overlay': 'var(--krypton-muted-overlay)',
        'krypton-shadow': 'var(--krypton-shadow)',
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
        'krypton-heading': '0.18em',
        'krypton-hero': '0.22em',
        'krypton-label': '0.12em',
        'krypton-mono': '0.025em',
      },
      fontSize: {
        'krypton-micro': ['0.6875rem', { lineHeight: '1rem' }],
        'krypton-nano': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      keyframes: {
        'krypton-drawer-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'krypton-drawer-out': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'krypton-overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'krypton-overlay-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
      spacing: {
        'krypton-space-1': '4px',
        'krypton-space-2': '8px',
        'krypton-space-3': '12px',
        'krypton-space-4': '16px',
        'krypton-space-5': '24px',
        'krypton-space-6': '32px',
      },
      maxWidth: {
        'krypton-signature': '24rem',
      },
      minWidth: {
        'krypton-signature': '20rem',
        'krypton-comparison': '48rem',
      },
    },
  },
  plugins: [],
};

export default config;
