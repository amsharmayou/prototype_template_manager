import { deriveFormBridge, renderBridge } from "./bridge";

/**
 * Build entry for the host runtime (`npm run build:billkit`).
 *
 * Same constraints as `lib/share/main.ts`: the bundle is dropped into an asset
 * directory and inlined by a host, so it may only reach for platform-free
 * modules. The IIFE format gives the host exactly one global to call, and this
 * file is the only place in `lib/billkit` allowed to touch `window` — which is
 * why the purity test excludes it and scans `bridge.ts` instead.
 */
declare global {
  interface Window {
    billkit: {
      deriveForm: typeof deriveFormBridge;
      render: typeof renderBridge;
    };
  }
}

if (typeof window !== "undefined") {
  const globalScope = window as unknown as {
    billkit?: Window["billkit"];
  };
  globalScope.billkit = {
    deriveForm: deriveFormBridge,
    render: renderBridge,
  };
}
