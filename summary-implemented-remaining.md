IMPLEMENTED:
- Phase 4C (print/lifecycle): RendererViewModel (PrintPipeline?, runtime restored), PreviewScreen (injected controller), PrintController (overrides/PageRange[] verified), RendererPresentationModule (single<PrintPipeline>), RendererViewModelTest (FakePrintController implements interface, no mock, asString fixed, missing params restored). Build: BUILD SUCCESSFUL.
- Phase 4B (repeat/formula): fillSampleData() verified (stable row samples, no meaningless collection key); formulas match bridge.
- Phase 4A (SAF/import): ZipPackageReader checksum verification (sha256Hex), ChecksumMismatch error, negative tests (checksum mismatch, truncated zip, decompression bomb). Data tests: BUILD SUCCESSFUL.
- Phase 5 (admin): /health endpoint, graceful shutdown (SIGTERM/SIGINT), Secure cookie flags (routes/views + app), download endpoint preserved with ETag.
- Phase 6 (parity): parity-check.mjs script added; Android bridge verified (BillKitShell.build -> source billkit.js); vendor directory noted.
- Phase 7 (persistence/onboarding): unsupported v1 label added in ExportMenu (single-page / no multi-page / no OCR); persistence/store intact.
- Phase 8 (acceptance): release checklist written at docs/verification/2026-10-18-phase8-checklist.md.

REMAINING (per plan 2026-10-18-billkit-product-completion-agent-plan.md):
Phases not started/completed: 0 (baseline report), 1 (contract), 2 (editor/colors/efficiency).
Manual verification remaining: device SAF open + fill + rotate/kill/restore (4A/4C/8); print geometry measurement (3); performance/release evidence (8); full golden fixtures/parity CI (6); full persistence audit/onboarding (7); global checklist 10 items evidenced.
