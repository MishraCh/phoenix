import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
  ],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Design system tokens
        slate: {
          900: "hsl(240 50% 10% / <alpha-value>)",
          800: "hsl(240 40% 16% / <alpha-value>)",
          700: "hsl(240 30% 26% / <alpha-value>)",
          500: "hsl(240 20% 45% / <alpha-value>)",
          300: "hsl(230 25% 65% / <alpha-value>)",
          100: "hsl(230 30% 85% / <alpha-value>)",
          50: "hsl(230 40% 96% / <alpha-value>)",
        },
        indigo: "hsl(252 87% 53% / <alpha-value>)",
        success: "hsl(152 100% 39% / <alpha-value>)",
        "success-soft": "hsl(152 55% 95% / <alpha-value>)",
        danger: "hsl(0 100% 60% / <alpha-value>)",
        "danger-soft": "hsl(0 55% 97% / <alpha-value>)",
        warning: "hsl(37 90% 55% / <alpha-value>)",
        "warning-soft": "hsl(37 80% 96% / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Semantic aliases
        card: "var(--radius-lg)",
        container: "var(--radius-xl)",
        shell: "var(--radius-2xl)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        panel: "var(--shadow-panel)",
        overlay: "var(--shadow-overlay)",
      },
    },
  },
  plugins: [],
};

export default config;
