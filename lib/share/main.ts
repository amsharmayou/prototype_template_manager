import { bootShareKit } from "@/lib/share/kit";

/**
 * Build entry for the standalone share runtime (`npm run build:share`).
 *
 * The bundle is dropped into `public/` and inlined verbatim into every shared
 * file, so it may only reach for platform-free modules: no React, no Fabric,
 * no module loader. The IIFE format gives the shared page one global, which is
 * the only handle its inline bootstrap needs.
 */
declare global {
  interface Window {
    bootShareKit: typeof bootShareKit;
  }
}

if (typeof window !== "undefined") {
  window.bootShareKit = bootShareKit;
}