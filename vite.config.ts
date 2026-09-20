import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { localApi } from "./server/dev-api";
import { loadEnv, defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Server-side secrets from .env.local reach the API middleware (never the client bundle).
  for (const key of ["BUFFER_API_KEY", "BLOB_READ_WRITE_TOKEN"]) {
    if (env[key]) process.env[key] = env[key];
  }
  return {
    server: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
    plugins: [localApi(), react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
