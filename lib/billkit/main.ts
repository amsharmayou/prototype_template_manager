import { deriveFormBridge, measureBridge, renderBridge } from "./bridge";
import { measureDom } from "./measure-dom";

/**
 * Build entry for the host runtime (`npm run build:billkit`).
 *
 * Same constraints as `lib/share/main.ts`: the bundle is dropped into an asset
 * directory and inlined by a host, so it may only reach for platform-free
 * modules. The IIFE format gives the host exactly one global to call, and this
 * file and `measure-dom.ts` are the only places in `lib/billkit` allowed to
 * touch `window` or `document` - which is why the purity test excludes them and
 * scans `bridge.ts` instead.
 */
declare global {
  interface Window {
    billkit: {
      deriveForm: typeof deriveFormBridge;
      /**
       * The boxes that need measuring, with their text already filled in.
       * Separate from `measure` so a host can see the work before doing it.
       */
      measurePlan: typeof measureBridge;
      /** Runs that plan against this runtime's font engine. */
      measure: typeof measureDom;
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
    measurePlan: measureBridge,
    measure: measureDom,
    render: renderBridge,
  };
}
