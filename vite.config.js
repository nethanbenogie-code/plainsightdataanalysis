import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Set to true if you'd rather `npm run dev` launched your browser for you.
    open: false,
  },
  build: {
    outDir: "dist",
  },
});
