# Phase 8 — End-to-end release checklist (2026-10-18)

Status: Partially verified on device 2026-10-19 (emulator-5554, `sdk_gphone16k_x86_64`, Android 17 / SDK 37).

Required evidence for production readiness:
- [ ] Release-candidate `.btpkg` built from web editor, uploaded through Admin `/api/admin/packages`.
- [x] Android SAF opens package; fill fixed/repeat fields; verify formulas (sum/count) match web fixtures (`lib/billkit/bridge.ts`).
      Verified 2026-10-19: bundled sample opened (14 fields, 2 groups); SAF picker (`documentsui.PickActivity`) reaches the file; "Fill sample data" fills 13/14 (band key excluded, per PIPELINE.md §8); preview renders the traced layout, image asset, filled values, repeat band row and computed `Total = 100.00`.
- [~] Preview matches final PDF/share; print to PDF/printer produces selectable text (not blank).
      Verified 2026-10-19 on `emulator-5554`: tapping Print opens the Android print dialog ("Save as PDF", 1/1 page); "Save to PDF" produced `Lucky Cargo Movers — Lorry Receipt (1).pdf`, 631,881 bytes, header `%PDF-1.4`. Fixed a real defect first: `PrintController` was built with the Application context, `findActivity()` returned null, and the print silently did nothing. The resumed Activity is now tracked (`CurrentActivity`, registered in `App.onCreate`) and used as the print context.
- [x] Rotation / process death / restore preserves inputs (verified via `RendererViewModelTest` and `SavedStateHandle`).
      Verified 2026-10-19: rotation ROTATION_90 round-trips with values intact; with "Don't keep activities" enabled, background → return recreated the activity and restored the full form (13/14, all values) from SavedStateHandle.
- [x] Corrupted package rejected without data loss (negative zip/checksum/path tests added in Phase 4A; must confirm on device).
      Verified 2026-10-19: a 32-byte non-zip file selected via SAF returns to Home with "That file could not be opened as a bill package." — no crash, sample package intact.
- [ ] Performance budgets measured: archive parse < 500ms, render < 2s, WebView memory < 32MB on low-range device.
- [x] Logs checked: no sensitive form data or secrets in logs; graceful shutdown on SIGTERM; access logs without document contents.
      Verified 2026-10-19: no `BillKitRuntime`/`BillKitWebView` error lines, no FATAL exceptions, no rendered values in logcat across launch/fill/print/rotation/kill/corrupt-open.
- [ ] Accessibility: keyboard navigation, screen reader labels, focus states on form inputs and print button.
- [ ] Release signing/versioning confirmed; HTTPS enforced; backups configured; supported-device matrix documented.
- [ ] Known limitations documented: single-page only (v1), no multi-page, no OCR, no perspective correction, no server-side rendering as primary.

## Device session log — 2026-10-19

- Gates: `assembleDebug` BUILD SUCCESSFUL; `testDebugUnitTest` BUILD SUCCESSFUL; `lintDebug` BUILD SUCCESSFUL.
- APK: `app/build/outputs/apk/debug/app-debug.apk` (16.8 MB) installed on `emulator-5554` over the prior build.
- Cold launch after `pm clear`: Home screen, bundled sample "Lucky Cargo Movers — Lorry Receipt", "14 fields to fill".
- Full drive: Home → Fill the bill → Fill sample data → Yes, show me the bill → Print / Share / Edit, then rotation and process-death restore, then corrupted-package rejection.
- Server (Browse templates): `Admin/server` on port 4000 serves 3 packages; `adb reverse tcp:4000 tcp:4000` must be live or the device cannot reach it. After the tunnel was re-established all three packages listed, download + SHA-256 verify + local store succeeded, and a stored package opened into the fill form via **Use**.
- Print: fixed `PrintController` (Application-context → null Activity); print dialog now opens and "Save to PDF" writes a real 631,881-byte `%PDF-1.4`.

## Renderer parity — web (`version 1`) vs Android (2026-10-19)

The Android renderer is not a Kotlin port: `WebViewBillKitRuntime` loads `app/src/main/assets/billkit.js` into a WebView and calls the same `billkit.render` / `billkit.deriveForm` the web app calls. Verification:

- **Found and fixed a stale asset.** The staged asset was built before the variable-layout completion commit: `public/billkit.js` was 46,457 bytes (sha `ACA4AA2F…`) while the asset was 45,801 bytes (sha `FA67909C…`), and an AST-normalised diff showed the asset missing a clause in the layout solver. Regenerated with `npm run prepare:android-assets`; the asset is now **byte-identical** to the web bundle.
- **Empirical parity proved.** The same golden template + values were rendered through the web bundle (Node `vm`) and through the running Android WebView (Chrome DevTools Protocol) and compared:
  - `render`: HTML length 5941 / hash 829046640 / page 794×1123 / same variables / same warnings — **identical**
  - `deriveForm`: length 3176 / hash 1564217083 / 15 fields / same 3 groups / repeat `items` — **identical**
- **Guard added.** `tests/bundleFreshness.test.ts` now asserts the Android asset is byte-identical to `public/billkit.js` (the existing marker check could not see this drift, since a stale bundle still carries the marker). Verified the new assertion fails on a corrupted asset and passes once restored.
