import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      "garment-worker-management-production.up.railway.app",
      "localhost",
      "127.0.0.1",
    ],
  },
});
