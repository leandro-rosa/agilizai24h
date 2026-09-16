import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin file tracing to the monorepo root. Next infers a workspace root on its
  // own, and the inference is what decides how deep the standalone output is
  // nested (`.next/standalone/frontend/apps/admin/server.js`, not a flat
  // `server.js`). Setting it explicitly keeps that path stable, so the
  // Dockerfile's COPY paths can't silently break when the workspace layout
  // changes.
  outputFileTracingRoot: path.join(__dirname, "../../.."),
  // Next dev blocks HMR/chunk requests whose Host doesn't match what it
  // expects — without this, loading the app from a LAN IP renders a blank
  // page (HTML loads, every JS chunk request gets rejected, nothing hydrates).
  allowedDevOrigins: process.env.ADMIN_ALLOWED_DEV_ORIGINS
    ? process.env.ADMIN_ALLOWED_DEV_ORIGINS.split(",")
    : undefined,
};

export default nextConfig;
