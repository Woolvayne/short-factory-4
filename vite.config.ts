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
  if (env.BUFFER_API_KEY) process.env.BUFFER_API_KEY = env.BUFFER_API_KEY;
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
