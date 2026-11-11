import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
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
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        bitcoin: {
          DEFAULT: "hsl(var(--bitcoin))",
          foreground: "hsl(var(--bitcoin-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        "paypal-blue": {
          DEFAULT: "hsl(var(--paypal-blue))",
          light: "hsl(var(--paypal-blue-light))",
        },
        "paypal-dark": "hsl(var(--paypal-dark))",
        "paypal-gold": "hsl(var(--paypal-gold))",
      },
      fontFamily: {
        // One family everywhere, like PayPal (CEO order 2026-11-11):
        // Manrope — the same app font Doc'O Clock ships. The display
        // alias resolves to Manrope too, so every font-display usage
        // (page titles, card titles, hero numbers) takes the same face.
        sans: ["Manrope", "system-ui", "-apple-system", "sans-serif"],
        display: ["Manrope", "system-ui", "-apple-system", "sans-serif"],
      },
      fontSize: {
        // PayPal type ramp (shared with Doc'O Clock): greeting = the
        // bold page header (28px/800), heronum = the hero card's
        // headline number (40px/800).
        greeting: ["1.75rem", { lineHeight: "1.15", fontWeight: "800", letterSpacing: "-0.02em" }],
        heronum: ["2.5rem", { lineHeight: "1", fontWeight: "800", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeInDown: {
          from: { opacity: "0", transform: "translateY(-20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        shimmer: {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        fadeIn: "fadeIn 0.5s ease-out forwards",
        fadeInUp: "fadeInUp 0.7s ease-out forwards",
        fadeInDown: "fadeInDown 0.7s ease-out forwards",
        scaleIn: "scaleIn 0.5s ease-out forwards",
        float: "float 5s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
      boxShadow: {
        subtle: "0 1px 3px rgba(0, 0, 0, 0.08)",
        medium: "0 4px 12px rgba(0, 0, 0, 0.1)",
        strong: "0 8px 24px rgba(0, 0, 0, 0.12)",
        glass: "0 4px 16px rgba(0, 0, 0, 0.06)",
      },
      // No backgroundImage utilities: no gradients anywhere in the
      // product (CEO rule, pinned in tests/design/paypalPalette).
      // The hero-pattern / gradient-radial / shimmer-gradient
      // entries that lived here were gradient definitions aimed at
      // hero bands — removed 2026-11-11 after the rendered pass
      // caught a gradient sheen on the dashboard balance band.
      // The one allowed sweep, the skeleton shimmer, is plain CSS
      // in index.css, not a surface background.
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
