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
  for (const key of ["BUFFER_API_KEY", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "S3_PUBLIC_BASE_URL"]) {
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
