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
  for (const key of [
    "BUFFER_API_KEY",
    "SHORTSFACTORY_PASSWORD",
    "STORAGE_PROVIDER",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL",
    "B2_S3_ENDPOINT",
    "B2_S3_REGION",
    "B2_KEY_ID",
    "B2_APPLICATION_KEY",
    "B2_BUCKET_NAME",
    "B2_PUBLIC_BASE_URL",
  ]) {
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
