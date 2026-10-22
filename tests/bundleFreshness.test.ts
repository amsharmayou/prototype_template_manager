import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The shipped bundles must contain the current layout solver.
 *
 * `public/billkit.js` and `public/sharekit.js` are built artefacts, and the
 * hosts that matter - the app's own preview, the share page, the Android
 * WebView - all run the *bundle*, not `lib/`. A bundle built before a renderer
 * change therefore serves the old layout to every host while the unit suite
 * stays green, which is the most expensive way for this feature to look
 * broken: it works everywhere except in front of the user.
 *
 * The marker is a diagnostic the solver emits, chosen because it survives
 * minification (a string literal) and because it only exists in a bundle built
 * from the variable-layout solver at all.
 */

const ROOT = resolve(__dirname, "..");
const MARKER = "could not be given the room its content needs";

const bundle = (file: string) => readFileSync(resolve(ROOT, "public", file), "utf8");

describe("the runtime bundles are current", () => {
  it("ships the layout solver in the BillKit runtime", () => {
    expect(bundle("billkit.js")).toContain(MARKER);
  });

  it("ships the layout solver in the share runtime", () => {
    expect(bundle("sharekit.js")).toContain(MARKER);
  });

  /**
   * The Android host must run the *same bytes* the web app builds.
   *
   * The Android renderer is not a Kotlin port: it loads `billkit.js` into a
   * WebView and calls the same `render`/`deriveForm` the web app calls. That
   * only holds if the copy in the APK's assets is the bundle just built. When
   * it is not, the Android app renders with a stale renderer while every unit
   * test - which imports `lib/`, not the asset - stays green, and the two
   * platforms silently disagree on the same package.
   *
   * The asset is a committed copy produced by `npm run prepare:android-assets`.
   * The marker check above cannot see this drift, because a stale bundle still
   * carries the marker; only a byte comparison can.
   */
  it("stages the Android asset as an exact copy of the web runtime", () => {
    const web = readFileSync(resolve(ROOT, "public", "billkit.js"));
    const asset = readFileSync(
      resolve(ROOT, "..", "Android", "app", "src", "main", "assets", "billkit.js"),
    );
    expect(
      asset.equals(web),
      "Android/app/src/main/assets/billkit.js is stale; run `npm run prepare:android-assets`",
    ).toBe(true);
  });
});

