/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "surface-ivory": "#FBF9F5",
        "primary": "#ff5100",
        "brand-orange-hover": "#E04500",
        "secondary-container": "#f4ebe6",
        "border-subtle": "#ead6cd",
        "border-strong": "#D3CEC2",
        "obsidian-dark": "#181311",
        "obsidian-muted": "#59534E",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Newsreader', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'monospace'],
      }
    },
  },
  plugins: [],
}
