import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Tailwind v4 runs as a Vite plugin and is configured in CSS (src/app.css) rather
// than a tailwind.config.js, so there is no PostCSS step and no autoprefixer.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // Pyodide's loader is an ES module, and Pyodide explicitly requires a
  // module-type worker.  Vite emits workers as IIFE by default, which would break
  // `new Worker(..., { type: 'module' })`.
  worker: { format: 'es' },
  build: {
    // Pyodide ships modern-only JS; targeting older syntax buys nothing here.
    target: 'es2022',
  },
});
