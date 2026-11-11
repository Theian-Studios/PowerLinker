import { defineConfig, loadEnv, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Makes the Chilean site's page Spanish: its language and the title shown on the browser tab.
 * @param chile - Whether this is the Chilean build (VITE_REGION=cl).
 * @returns The plugin, which leaves the English page as it is.
 */
function regionPage(chile: boolean): Plugin {
  return {
    name: "region-page",
    transformIndexHtml: (html) => chile
      ? html.replace('<html lang="en">', '<html lang="es">').replace("<title>Power Linker</title>", "<title>PowerLinker Chile</title>")
      : html,
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tsconfigPaths(), regionPage(loadEnv(mode, process.cwd(), "VITE_").VITE_REGION === "cl")],
}));
