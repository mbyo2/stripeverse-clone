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
        "theme-blue": {
          light: "#60A5FA",
          DEFAULT: "#3B82F6",
          dark: "#2563EB"
        },
        "theme-green": {
          light: "#4ADE80",
          DEFAULT: "#22C55E",
          dark: "#16A34A"
        },
        "theme-purple": {
          light: "#A78BFA",
          DEFAULT: "#8B5CF6",
          dark: "#7C3AED"
        }
      },
      fontFamily: {
        sans: ["SF Pro Display", "system-ui", "sans-serif"],
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
      transitionTimingFunction: {
        "apple-ease": "cubic-bezier(0.25, 0.1, 0.25, 1)",
      },
      boxShadow: {
        subtle: "0px 2px 5px rgba(0, 0, 0, 0.05)",
        medium: "0px 4px 10px rgba(0, 0, 0, 0.1)",
        strong: "0px 10px 25px rgba(0, 0, 0, 0.15)",
        glass: "0 8px 32px rgba(0, 0, 0, 0.06)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "glass-gradient": "linear-gradient(to right bottom, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.2))",
        "shimmer-gradient": "linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0) 100%)",
        "gradient-blue": "linear-gradient(to right bottom, var(--tw-gradient-stops))",
        "gradient-green": "linear-gradient(135deg, rgb(34, 197, 94) 0%, rgb(16, 185, 129) 100%)",
        "gradient-purple": "linear-gradient(135deg, rgb(139, 92, 246) 0%, rgb(124, 58, 237) 100%)",
        "hero-pattern": "linear-gradient(to right bottom, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1))"
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
