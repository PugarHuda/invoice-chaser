// PostCSS config is auto-discovered by Vite in both middleware mode
// (server/index.mjs, configFile: false) and the standalone `vite build`
// verification — so Tailwind processes in both without a vite.config.js.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
