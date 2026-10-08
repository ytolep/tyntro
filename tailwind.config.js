/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: "#09090d",
        surface: "#101015",
        "surface-border": "#25252e",
        "surface-hover": "#19191f",
        profit: "#8ff0cc",
        loss: "#ef8390",
        brand: {
          50: "#e6fcf5",
          100: "#c0f7e6",
          500: "#8ff0cc",
          600: "#b7a0ff",
          700: "#9274dc",
        },
        cyanAccent: "#b7a0ff",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
