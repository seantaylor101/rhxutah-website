import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4000",
    },
    // shared/ (house geometry used by both client and server) sits next to
    // client/, outside the dev server's default allowed root
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
  },
});
