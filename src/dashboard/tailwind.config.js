/** @type {import("tailwindcss").Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        "krypton-radius-card": "12px",
        "krypton-radius-control": "6px",
        "krypton-radius-full": "9999px",
      },
      colors: {
        "krypton-accent-cyan": "#22d3ee",
        "krypton-alert-rose": "#fb7185",
        "krypton-bg-main": "#020617",
        "krypton-bg-surface": "#0f172a",
        "krypton-border-muted": "#1e293b",
        "krypton-warning-amber": "#fbbf24",
      },
      spacing: {
        "krypton-space-1": "4px",
        "krypton-space-2": "8px",
        "krypton-space-3": "12px",
        "krypton-space-4": "16px",
        "krypton-space-5": "24px",
        "krypton-space-6": "32px",
      },
    },
  },
  plugins: [],
};

export default config;
