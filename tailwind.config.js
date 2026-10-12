/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        surface: '#161b22',
        surfaceHover: '#1f242c',
        border: '#30363d',
        primary: '#3b82f6',
        primaryHover: '#2563eb',
        accent: '#8b5cf6',
      }
    },
  },
  plugins: [],
}
