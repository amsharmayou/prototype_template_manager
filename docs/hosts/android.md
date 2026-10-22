# Android host integration

How a Kotlin Android app hosts the authoring pipeline's renderer (the
`billkit` bundle) inside a WebView, and what the host must supply so a bill
prints the same on a device as it does in the desktop preview.

The `npm run prepare:android-assets` build step stages everything a WebView
host needs into the asset directory:

| Asset | What it is |
|---|---|
| `billkit.js` | The host runtime IIFE: `deriveForm`, `measurePlan`, `measure`, `render`, `openBundle`. |
| `sharekit.js` | The standalone fill-and-print page for completed templates. |
| `fonts/` | The bundled font set (`.ttf` files + `fonts.json`). Measurement and the print engine compute from these bytes. |
| `harfbuzz/hb.wasm` | (Optional) the shaping WASM, so complex-script runs print as outlines rather than refusing. Loaders copy it from the repo the same way. |

The `bundle freshness` test asserts the staged copy equals the web build, so a
stale asset fails CI rather than behaving differently in the field.

## Loading order in the WebView

1. Load `billkit.js` (one global: `window.billkit`).
2. Provide `openBundle` with the shipment bytes and the verification options
   the deployment requires. Nothing else may admit a bundle:

   ```js
   const opened = await billkit.openBundle(bytes, {
     engineVersion: 1,                 // refuse bundles needing a newer engine
     verify: {                         // optional signature ingest
       publicKeyPem: trustedPem,
       keyId: "vendor-2026",
       required: true,                 // refuse unsigned shipments outright
     },
   });
   if (!opened.ok) {
     // opened.refusals: every problem, one string each, ready for the UI
     return;
   }
   const schema = billkit.deriveForm(opened.bundle.manifest, opened.template);
   ```

3. Build the form from `schema` (fields in `schema.groups`, repeating fields
   through `schema.repeats`), bind inputs by `name`, and keep repeating rows
   as one JSON value under the repeat key.
4. Measure, then render, exactly as the desktop preview does:

   ```js
   const plan = billkit.measurePlan(                       // authored template in
     JSON.stringify(opened.template),
     JSON.stringify(values),
     JSON.stringify(computed),
     JSON.stringify({                                       // bridge options (v2)
       currencyScale: opened.bundle.manifest.document.currencyScale,
       rounding: opened.bundle.manifest.document.rounding,
       qtyScale: opened.bundle.manifest.document.quantityScale,
     }),
   );
   const measurements = billkit.measure(plan);
   const { html } = billkit.render(
     JSON.stringify(opened.template),
     JSON.stringify(values),
     JSON.stringify(computed),
     JSON.stringify(measurements),
     JSON.stringify(options),
   );
   ```

   `render` runs the whole pipeline once (compute -> display shaping -> bind ->
   band lines -> pages). The html carries one `.sheet` per page with a page
   break, so the WebView print dialog produces one printed page per sheet. In
   theory print margins should be zero — the sheet already owns its geometry.

## Bridge options (v2)

The fourth argument to `measurePlan` and the fifth to `render` carry the
document's own numbers; a host must read them *from the manifest it opened*,
never hard-code them:

| Field | Meaning |
|---|---|
| `currencyScale` | Decimal places money is held in (from `document.currencyScale`). |
| `rounding` | The written rounding rule (`document.rounding`). |
| `qtyScale` | Decimal places a count operand is read at (`document.quantityScale`). |

## What the host must not do

- **No direct unzip** — checksums, the engine-version gate, the template
  identity hash and the signature are all verified inside `openBundle`. A host
  that picks files out of the zip itself prints outside the contract.
- **No font substitution** — if a font file or the shaping WASM is missing from
  staged assets, the pipeline refuses with a named message. Stage the whole
  `fonts/` directory; do not prune it.
- **No bespoke money formatting** — computed values and display shaping are
  the engine's job; a host reformats a figure and the device no longer prints
  the same bill the author approved.
