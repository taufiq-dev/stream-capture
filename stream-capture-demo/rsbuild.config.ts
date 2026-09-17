import path from "node:path";
import { defineConfig } from "@rsbuild/core";
import { pluginBasicSsl } from "@rsbuild/plugin-basic-ssl";
import { pluginReact } from "@rsbuild/plugin-react";

const demoModules = path.resolve(import.meta.dirname, "node_modules");

// getUserMedia needs a secure context. http://localhost counts as one, but a phone on the LAN needs
// HTTPS, so `pnpm dev` serves a self-signed cert; `pnpm dev:http` skips it for desktop-only work.
const useHttps = process.env.DEMO_HTTP !== "1";

export default defineConfig({
  plugins: [pluginReact(), ...(useHttps ? [pluginBasicSsl()] : [])],
  html: { title: "stream-capture demo" },
  server: { host: "0.0.0.0" },
  resolve: {
    alias: { "@stream-capture": path.resolve(import.meta.dirname, "../stream-capture") },
  },
  tools: {
    rspack: {
      // ../stream-capture stays a plain folder with no node_modules of its own, so its bare imports
      // (react, styled-components, valibot) resolve against this app's dependencies.
      resolve: { modules: [demoModules, "node_modules"] },
    },
  },
});
