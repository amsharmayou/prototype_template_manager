# Graph Report - version 1  (2026-10-17)

## Corpus Check
- 234 files · ~383,883 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2031 nodes · 4585 edges · 137 communities (118 shown, 19 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 169 edges (avg confidence: 0.82)
- Token cost: 2,950 input · 1,820 output

## Community Hubs (Navigation)
- Table Editing & Snapping
- BillKit Browser Bundle
- ShareKit Browser Bundle
- Layout Authoring Panel
- Workflow E2E Test Helpers
- Render Layout Engine
- Export Menu & Sharing
- Canonicalization & Refusal Rules
- Renderer Design Concepts
- Editor Controller Lifecycle
- Grouping & Snapping Plans
- Package Layout Metadata
- HTML Primitive Renderers
- Dynamic Form Derivation
- TypeScript Config Globs
- Context & Placeholder Panels
- Tool Rail & Shortcuts
- Render Measurement Bridge
- Package Writing & Hashing
- Template Migration
- Share Fixture Generator
- Bill Field Model
- Table Repeat & Types
- Measurement & Row Heights
- Design System & Identity
- Selection Transforms & Cells
- Template Serialization
- Asset MIME Resolution
- App Layout & Fonts
- Template Loading & Fit
- Viewport & Zoom
- Render Page Client
- Tooling Dev Dependencies
- Package Validation Rules
- Package Metadata Records
- Package Build Pipeline
- Computed Values & Formatting
- Data Binding & Field Extraction
- App Shell & Editor Mount
- Bill Part Cropping
- Package Export & Round-Trip
- Guide Attachment Tests
- Properties Panel Controls
- Runtime Dependencies
- HTML Renderer Spec
- Repeat Expansion & Tokens
- Multi-Appearance & Shared Selection
- History Stack
- Step Path & Workflow Steps
- Trace View UI Screenshot
- Tool Call Sample Records
- Agent Model Roles
- OpenCode Model Providers
- NPM Scripts
- Placeholders & Text Panel
- Dynamic Form & Repeat Rows
- Plan3 Wizard Screenshot
- Trace Rectangle Inspector Screenshot
- Mark Data Fields Screenshot
- HTML Renderer Plan Tasks
- Table Resize & Unification Plan
- Android Library & Format Plans
- Snapshot & Part Capture API
- Guides & Object Editing
- Image Placeholder Object
- Money Spellout Words
- Expandable Bill E2E Test
- Field Object Rendering
- Bill Part Object
- Free Model List (DeepSeek)
- Vision-capable Model List
- Layers & Stage Bar UI
- Render Share Polish Spec
- Editor E2E Helpers
- Group Tree Helpers
- Snapping Engine
- Package Validation Tests
- Free Model List (GLM)
- Layout Guides E2E Test
- Variable Layout E2E Test
- Keyboard Shortcuts & Tools
- DeepSeek Provider Config
- Claude Provider Config
- Package Allowlist Config
- Variable Layout Bill Test
- Editor UI Overview Screenshot
- Five-Step Workflow Screenshot
- BillKit Package E2E Test
- Test Bill Invoice Fixtures
- Table Guides E2E Test
- Stroke Defaults
- Share Kit Bootstrapping
- Purity Guard Tests
- UI Design Tokens
- Template Server Plan
- BillKit Package Spec
- Template Server Spec
- Inspector E2E Test
- Atria Model Config
- Wireframe Screen 4 Screenshot
- Tinted Bill Fixture Image
- Row Heights E2E Test
- Table Dialog E2E Test
- E2E Canvas Probe Helpers
- BillKit Bridge Test
- Android Splash Screen Image
- Field & Bill Part Tools Screenshot
- Wireframe Screenshot 1
- Wireframe Screenshot 3
- Guides Never Render Test
- Two-Column Panel Wireframe
- Wireframe Screenshot 5
- Long Bill Scroll Fixture
- Shared Template HTML Fixture
- Share E2E Test
- Render E2E Test
- Table Grid E2E Test
- Live Text Object
- Astra Model Config
- Bundle Freshness Test
- ESLint Config
- Next Config
- Playwright Dependency
- Node Types Dependency
- Playwright Config
- PostCSS Config

## God Nodes (most connected - your core abstractions)
1. `EditorController` - 149 edges
2. `BillTemplate` - 61 edges
3. `BillTable` - 55 edges
4. `renderHtml()` - 43 edges
5. `TemplateObject` - 36 edges
6. `buildPackage()` - 28 edges
7. `Rt()` - 26 edges
8. `TableObject` - 25 edges
9. `calculateLayout()` - 24 edges
10. `useKeyboardShortcuts()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Page and Reference Image as One Surface` --references--> `Canvas and Image Unification Spec`  [INFERRED]
  README.md → docs/superpowers/specs/2026-09-30-canvas-image-unification-design.md
- `DocumentPanel()` --calls--> `emptyTemplate()`  [EXTRACTED]
  components/editor/ContextPanel.tsx → lib/template/types.ts
- `run()` --calls--> `calculateLayout()`  [EXTRACTED]
  tests/layoutXAxis.test.ts → lib/render/layout.ts
- `templateWith()` --calls--> `emptyTemplate()`  [EXTRACTED]
  tests/dataBinding.test.ts → lib/template/types.ts
- `Tt()` --indirect_call--> `c()`  [INFERRED]
  public/billkit.js → tests/packageForm.test.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **BillKit Delivery Chain (package format -> shared package -> server -> Android, on the pure renderer)** — docs_superpowers_plans_2026_10_08_billkit_package_phase_1_2, docs_superpowers_plans_2026_10_12_shared_format_package, docs_superpowers_plans_2026_10_12_template_server_express, docs_superpowers_plans_2026_10_12_android_template_library, docs_superpowers_plans_2026_09_30_generalized_html_renderer [INFERRED 0.85]
- **Variable Layout Lineage (Expanding_Bill -> New_Expandable -> findings -> completion, plus the Explain user guide)** — docs_expanding_bill, docs_new_expandable, docs_variable_test_findings, docs_superpowers_plans_2026_10_15_new_expandable_completion, docs_explain [INFERRED 0.85]
- **Engine Purity and Golden-File Guards Across Packages** — docs_superpowers_plans_2026_09_30_generalized_html_renderer, docs_superpowers_plans_2026_10_08_billkit_package_phase_1_2, docs_superpowers_plans_2026_10_12_shared_format_package, docs_superpowers_plans_2026_10_15_new_expandable_completion [INFERRED 0.75]
- **UI Redesign Plan Sequence (spec plus three implementation plans)** — docs_superpowers_specs_2026_10_16_editor_ui_redesign_design, docs_superpowers_plans_2026_10_16_ui_redesign_1_design_system, docs_superpowers_plans_2026_10_16_ui_redesign_2_shell, docs_superpowers_plans_2026_10_16_ui_redesign_3_inspector [EXTRACTED 0.85]
- **Fabric-Free Canvas Modules** — docs_superpowers_specs_2026_09_30_generalized_html_renderer, docs_superpowers_specs_2026_09_30_canvas_image_unification_design, docs_superpowers_specs_2026_10_05_snapping_guides_design, docs_superpowers_specs_2026_10_05_grouping_and_text_wrapping_design [INFERRED 0.75]
- **HTML Render Pipeline (renderer to share to package to server)** — docs_superpowers_specs_2026_09_30_generalized_html_renderer, docs_superpowers_specs_2026_10_04_render_share_and_rendering_polish, docs_superpowers_specs_2026_10_08_billkit_package_design, docs_superpowers_specs_2026_10_12_template_server_design [INFERRED 0.75]
- **Wireframe Template Composition (layout, placeholder fields, annotation guides)** — docs_screenshots_1, docs_screenshots_1_wireframe_layout, docs_screenshots_1_field_1_placeholder, docs_screenshots_1_placeholder_field_system [INFERRED 0.75]
- **Two-Column Panel Composition** — docs_screenshots_2_wireframe_layout, docs_screenshots_2_left_column, docs_screenshots_2_right_column, docs_screenshots_2_asymmetric_panel_grid [EXTRACTED 1.00]
- **Screenshot 3 Wireframe Layout Composition** — docs_screenshots_3_text_block, docs_screenshots_3_media_placeholders, docs_screenshots_3_page_frame [EXTRACTED 1.00]
- **Screen 4 Layout Component Group** — docs_screenshots_4_placeholder_text_block, docs_screenshots_4_content_image_placeholder, docs_screenshots_4_sidebar_thumbnail_placeholder, docs_screenshots_4_overlapping_card_panel [INFERRED 0.85]
- **Wireframe Composed of Text Block and Placeholder Boxes** — docs_screenshots_5_text_placeholder_block, docs_screenshots_5_empty_content_boxes, docs_screenshots_5_block_content_page_pattern [INFERRED 0.85]
- **Bill photo trace-over flow (steps 1-2: Your bill -> Trace)** — docs_screenshots_plan3_1_your_bill_photo_bill_template_wizard, docs_screenshots_plan3_1_your_bill_photo_trace_over_workflow, docs_screenshots_plan3_1_your_bill_photo_bill_reference_layer, docs_screenshots_plan3_1_your_bill_photo_acme_invoice [EXTRACTED 1.00]
- **Editor workspace layout (tool palette, canvas page, properties, layers)** — docs_screenshots_plan3_1_your_bill_photo_tool_palette, docs_screenshots_plan3_1_your_bill_photo_template_page, docs_screenshots_plan3_1_your_bill_photo_properties_panel, docs_screenshots_plan3_1_your_bill_photo_layers_panel [INFERRED 0.85]
- **Bill Tracing Workflow (Step 2)** — docs_screenshots_plan3_2_trace_rectangle_inspector_workflow_stepper, docs_screenshots_plan3_2_trace_rectangle_inspector_trace_step, docs_screenshots_plan3_2_trace_rectangle_inspector_bill_photo_reference, docs_screenshots_plan3_2_trace_rectangle_inspector_rectangle_object, docs_screenshots_plan3_2_trace_rectangle_inspector_draw_tools [EXTRACTED 1.00]
- **Traced Object Selection and Classification** — docs_screenshots_plan3_2_trace_rectangle_inspector_rectangle_object, docs_screenshots_plan3_2_trace_rectangle_inspector_object_inspector, docs_screenshots_plan3_2_trace_rectangle_inspector_semantic_chips, docs_screenshots_plan3_2_trace_rectangle_inspector_layers_panel [INFERRED 0.85]
- **Trace Step Workspace** — docs_screenshots_plan3_3_text_section_bill_template_maker, docs_screenshots_plan3_3_text_section_reference_overlay, docs_screenshots_plan3_3_text_section_tools_palette, docs_screenshots_plan3_3_text_section_grid, docs_screenshots_plan3_3_text_section_document_panel [INFERRED 0.85]
- **Text Field Binding and Editing Flow** — docs_screenshots_plan3_3_text_section_canvas_selection, docs_screenshots_plan3_3_text_section_field_binding_panel, docs_screenshots_plan3_3_text_section_text_object_properties, docs_screenshots_plan3_3_text_section_layers_panel [INFERRED 0.75]
- **Mark data step UI flow** — docs_screenshots_plan3_4_mark_step_data_fields_field_tool, docs_screenshots_plan3_4_mark_step_data_fields_data_field_placeholder, docs_screenshots_plan3_4_mark_step_data_fields_layers_panel, docs_screenshots_plan3_4_mark_step_data_fields_designer_canvas [EXTRACTED 1.00]
- **Trace workspace composition (photo underlay, canvas, table, layers)** — docs_screenshots_plan3_5_table_section_bill_photo_reference, docs_screenshots_plan3_5_table_section_document_canvas, docs_screenshots_plan3_5_table_section_table_object, docs_screenshots_plan3_5_table_section_layers_panel [INFERRED 0.85]
- **Bill data binding to fill/print output flow** — docs_screenshots_plan3_5_table_section_repeating_rows, docs_screenshots_plan3_5_table_section_customer_name_field, docs_screenshots_plan3_5_table_section_fill_and_print [INFERRED 0.75]
- **Long-Scroll Fixture Pattern (image + line markers + bottom sentinel)** — e2e_fixtures_long_bill_image, e2e_fixtures_long_bill_line_markers, e2e_fixtures_long_bill_bottom_of_page [INFERRED 0.85]
- **Invoice billing structure (line items feed amounts and totals)** — e2e_fixtures_test_bill_invoice, e2e_fixtures_test_bill_widget_a, e2e_fixtures_test_bill_gadget_b, e2e_fixtures_test_bill_subtotal_total [EXTRACTED 1.00]
- **Invoice header metadata (vendor, customer, number, date)** — e2e_fixtures_test_bill_acme_trading_co, e2e_fixtures_test_bill_jane_doe, e2e_fixtures_test_bill_invoice_number_inv_1001, e2e_fixtures_test_bill_invoice_date_2026_01_15 [EXTRACTED 1.00]
- **Tinted Bill Invoice Document Layout** — e2e_fixtures_tinted_bill_acme_logo, e2e_fixtures_tinted_bill_invoice_2291, e2e_fixtures_tinted_bill_total_due, e2e_fixtures_tinted_bill_payment_reference [EXTRACTED 1.00]
- **Android App Launch Splash Composition** — tools_android_home_grid_circle_icon, tools_android_home_android_robot_logo, tools_android_home_brand_green_palette, tools_android_home_splash_screen [INFERRED 0.85]
- **Editor Sidebar Panel System** — tools_guide_visible_reference_image_panel, tools_guide_visible_grid_panel, tools_guide_visible_document_panel, tools_guide_visible_placeholders_panel, tools_guide_visible_properties_panel, tools_guide_visible_layers_panel [INFERRED 0.85]
- **Bill Template Authoring Flow (trace, annotate, bind, render, export)** — tools_guide_visible_tool_palette, tools_guide_visible_canvas, tools_guide_visible_bill_part, tools_guide_visible_placeholder_token, tools_guide_visible_fill_and_render, tools_guide_visible_export [INFERRED 0.75]

## Communities (137 total, 19 thin omitted)

### Community 0 - "Table Editing & Snapping"
Cohesion: 0.06
Nodes (33): snap(), BillTable, BillTableSpec, DEFAULT_TABLE_SPEC, makeCells(), TableResizeGesture, GridSegment, gridSegments() (+25 more)

### Community 1 - "BillKit Browser Bundle"
Cohesion: 0.08
Nodes (70): add(), ae(), an(), At(), Be(), bn(), Bt(), Cn() (+62 more)

### Community 2 - "ShareKit Browser Bundle"
Cohesion: 0.08
Nodes (71): add(), Ae(), An(), At(), bn(), Bt(), Ce(), Ct() (+63 more)

### Community 3 - "Layout Authoring Panel"
Cohesion: 0.07
Nodes (32): anchorOptions(), AttachSection(), BEHAVIOR_OPTIONS, COLLISION_OPTIONS, CONTAINER_GROWTH_OPTIONS, DOCUMENT_GROWTH_OPTIONS, EDGE_OPTIONS, edgesFor() (+24 more)

### Community 4 - "Workflow E2E Test Helpers"
Cohesion: 0.05
Nodes (12): CropPixels, EditorWindow, FIXTURE, Live, LONG_FIXTURE, Saved, SavedBillPart, StageMetrics (+4 more)

### Community 5 - "Render Layout Engine"
Cohesion: 0.09
Nodes (28): allocateAxis(), anchorOf(), AxisResult, Box, calculateLayout(), containerOf(), contains(), finite() (+20 more)

### Community 6 - "Export Menu & Sharing"
Cohesion: 0.17
Nodes (30): ExportItem, ExportMenu(), ITEMS, shareTemplateAsHtml(), downloadBlob(), downloadJson(), downloadText(), safeFilename() (+22 more)

### Community 7 - "Canonicalization & Refusal Rules"
Cohesion: 0.11
Nodes (21): canonicalJson(), FAMILIES, NAMED, Refusal, Refusals, safeLength(), ENTITIES, docName() (+13 more)

### Community 8 - "Renderer Design Concepts"
Cohesion: 0.07
Nodes (33): Document Renderer and Printer (TransportApp2 Pipeline), Schema v2 Layout Pipeline (TemplateV2.md), Six-Stage Render Pipeline, Acquisition and Refusal (TemplateParser.kt), Values, Not Formulas, Version-Pinned Reprint Path, Whitelisted Expression Calculator (Expressions.kt), BillKit Variable Layout & Expandable Structure (Expanding_Bill) (+25 more)

### Community 10 - "Grouping & Snapping Plans"
Cohesion: 0.08
Nodes (32): Grouping and Text Wrapping Implementation Plan, Authoring-Only Grouping, Group Tree Helpers, History Snapshots for Group Operations, Non-Destructive Ungroup, Geometry-Derived Wrap Width, Snapping and Guides Implementation Plan, Full-Span Divider Guides (+24 more)

### Community 11 - "Package Layout Metadata"
Cohesion: 0.08
Nodes (28): ANCHORS, BEHAVIOURS, COLLISIONS, CONTAINER_GROWTH, EDGES, GROWTH, isFiniteNumber(), isRecord() (+20 more)

### Community 12 - "HTML Primitive Renderers"
Cohesion: 0.23
Nodes (31): fontStack(), safeAngle(), safeColor(), safeOpacity(), attr(), escapeHtml(), align(), ALIGNMENTS (+23 more)

### Community 13 - "Dynamic Form Derivation"
Cohesion: 0.14
Nodes (24): BuildOptions, columnsOf(), deriveForm(), FormField, FormGroup, FormSchema, GROUP_TITLES, RepeatFieldSpec (+16 more)

### Community 14 - "TypeScript Config Globs"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 15 - "Context & Placeholder Panels"
Cohesion: 0.11
Nodes (23): ContextPanel(), DocumentPanel(), HINTS, FAMILY_OPTIONS, isListedFamily(), PlaceholdersPanel(), Row, SpecEditor() (+15 more)

### Community 16 - "Tool Rail & Shortcuts"
Cohesion: 0.11
Nodes (23): GROUPS, SHORTCUTS, TOOL_ICONS, ToolRail(), analysePlaceholdersSafe(), APP_TYPE_FOR, isPolygonMarker(), Listener (+15 more)

### Community 17 - "Render Measurement Bridge"
Cohesion: 0.13
Nodes (21): deriveFormBridge(), measureBridge(), MeasurementRequest, Measurements, renderBridge(), RenderBridgeResult, Window, measureDom() (+13 more)

### Community 18 - "Package Writing & Hashing"
Cohesion: 0.13
Nodes (20): writePackage(), H, hex(), K, rotr(), sha256Hex(), sha256HexBytes(), sha256HexFromBytes() (+12 more)

### Community 19 - "Template Migration"
Cohesion: 0.09
Nodes (15): migrateTemplate(), A4_HEIGHT, A4_WIDTH, LayoutConfig, PlaceholderSpec, TEMPLATE_VERSION, layout, page (+7 more)

### Community 20 - "Share Fixture Generator"
Cohesion: 0.10
Nodes (16): kit, logoSlot, out, template, buildShareDocument(), embedJson(), safeScript(), emptyTemplate() (+8 more)

### Community 21 - "Bill Field Model"
Cohesion: 0.15
Nodes (20): DEFAULT_FIELD, FieldSpec, distribute(), evenSizes(), applyCommon(), hydrateBillPart(), hydrateField(), hydrateFreehand() (+12 more)

### Community 22 - "Table Repeat & Types"
Cohesion: 0.11
Nodes (18): normaliseRepeat(), AxisExpansion, BillPartObject, ContainerPadding, DEFAULT_REPEAT_MAX_ITEMS, FieldObject, FreehandObject, GroupObject (+10 more)

### Community 23 - "Measurement & Row Heights"
Cohesion: 0.13
Nodes (18): ContentMeasurement, MeasurementSource, expandRepeats(), applyRowHeights(), cellKey(), CellRequest, cellRequests(), RowHeightLimits (+10 more)

### Community 24 - "Design System & Identity"
Cohesion: 0.12
Nodes (25): Bill Template Maker Design Sheet (identity.html), Ink, Ledger, Stamp and Marker Palette, Three Type Roles (Bitter, Archivo, IBM Plex Mono), UI Redesign Plan 1: Design System & First Surface, Canvas Token Mirror, Controls API Stability, Design Token Layer, Three-Font Type System (+17 more)

### Community 26 - "Template Serialization"
Cohesion: 0.22
Nodes (21): baseFields(), defaultName(), num(), objectBox(), pathData(), readContainer(), readExpansion(), readPoints() (+13 more)

### Community 27 - "Asset MIME Resolution"
Cohesion: 0.11
Nodes (20): extensionOf(), FALLBACK_MIME, isTrustedMime(), mimeFor(), resolvePackage(), toDataUri(), guideY, layout (+12 more)

### Community 28 - "App Layout & Fonts"
Cohesion: 0.15
Nodes (15): archivo, bitter, metadata, plexMono, KIND_STYLES, ToastApi, ToastContext, ToastInput (+7 more)

### Community 30 - "Viewport & Zoom"
Cohesion: 0.18
Nodes (16): clampPan(), clampZoom(), containScale(), fitView(), isFiniteNumber(), MAX_ZOOM, PAN_SLACK, panBy() (+8 more)

### Community 31 - "Render Page Client"
Cohesion: 0.24
Nodes (15): RenderClient, NO_COMPUTED, RenderClient(), sampleValue(), OpenMenu(), Button(), consumePendingTemplate(), deleteTemplate() (+7 more)

### Community 32 - "Tooling Dev Dependencies"
Cohesion: 0.10
Nodes (21): eslint-config-next, @eslint/eslintrc, devDependencies, eslint, eslint-config-next, @eslint/eslintrc, tailwindcss, @tailwindcss/postcss (+13 more)

### Community 33 - "Package Validation Rules"
Cohesion: 0.18
Nodes (20): ASSET_ROLES, COLUMN_OPS, columnArgMessage(), columnHead(), COMPUTED_OPS, ComputedNode, FIELD_SOURCES, FIELD_TYPES (+12 more)

### Community 34 - "Package Metadata Records"
Cohesion: 0.12
Nodes (21): name, npm, options, options, name, npm, options, Authorization (+13 more)

### Community 35 - "Package Build Pipeline"
Cohesion: 0.17
Nodes (17): bandColumns(), buildPackage(), declaredMime(), decodeDataUri(), imageExtension(), safeName(), renamedPackage(), templated() (+9 more)

### Community 36 - "Computed Values & Formatting"
Cohesion: 0.23
Nodes (17): cache, cell(), computeAll(), flat(), formatMinorUnits(), has(), isDigit(), itemsOf() (+9 more)

### Community 37 - "Data Binding & Field Extraction"
Cohesion: 0.14
Nodes (14): ACRONYMS, extractTemplateFields(), FieldSource, FieldType, fillTemplate(), humanizeKey(), inferType(), cell_texts (+6 more)

### Community 38 - "App Shell & Editor Mount"
Cohesion: 0.18
Nodes (9): BillEditor(), Stage, CanvasStage(), TopBar(), UploadScreen(), useToast(), useEditorController(), renderSampleBill() (+1 more)

### Community 39 - "Bill Part Cropping"
Cohesion: 0.19
Nodes (14): BillPartCrop, clippedDocumentRect(), cropBillPart(), CropOptions, DocumentRect, imageRectForBox(), clampChannel(), distance() (+6 more)

### Community 40 - "Package Export & Round-Trip"
Cohesion: 0.23
Nodes (13): blockingIssues(), buildPackageBytes(), describeIssues(), exportPackage(), PackageExportResult, packageFilename(), BandedTable, computedSpecsFor() (+5 more)

### Community 41 - "Guide Attachment Tests"
Cohesion: 0.12
Nodes (12): GuideAttachment, attachment(), CELL, GUIDE, run(), SHORT, table(), TALL (+4 more)

### Community 42 - "Properties Panel Controls"
Cohesion: 0.12
Nodes (7): LayoutPanels(), ALIGN_BUTTONS, FONT_OPTIONS, FONTS, PropertiesPanel(), ROLE_CHIPS, ContainerPolicy

### Community 43 - "Runtime Dependencies"
Cohesion: 0.12
Nodes (17): docx, jspdf, lucide-react, next, dependencies, docx, fabric, fflate (+9 more)

### Community 44 - "HTML Renderer Spec"
Cohesion: 0.16
Nodes (16): Generalized HTML Renderer Spec, Byte-Identical Output, Layout Engine (lib/render/layout.ts), Pure HTML Renderer, Inert Self-Contained HTML, Portable Template Contract, A4 Table Golden Render, Table Primitive Render (+8 more)

### Community 45 - "Repeat Expansion & Tokens"
Cohesion: 0.19
Nodes (11): Band, bandOf(), expandTable(), jsonArrayLength(), resolveScoped(), tokenRegex(), resolveText(), tokenRegex() (+3 more)

### Community 46 - "Multi-Appearance & Shared Selection"
Cohesion: 0.25
Nodes (12): MultiAppearancePanel(), acceptsSharedPaint(), acceptsVisibility(), agree(), SharedKey, sharedSelection, Placed, TemplateObject (+4 more)

### Community 47 - "History Stack"
Cohesion: 0.15
Nodes (3): HistoryEntry, HistoryStack, Doc

### Community 48 - "Step Path & Workflow Steps"
Cohesion: 0.31
Nodes (9): StepPath(), firstIncomplete(), nextStep(), STEP_COMPLETE, STEP_LABELS, STEP_ORDER, stepDone(), StepFacts (+1 more)

### Community 49 - "Trace View UI Screenshot"
Cohesion: 0.21
Nodes (13): Bill Photo Reference Layer (opacity 25%, never exported), Bill Template Maker Web App (Trace view), customer_name Text Placeholder (Text 2), Document Canvas (794 × 1123 px A4 page), Drawing & Content Toolbar (Line, Rectangle, Ellipse, Freehand, Guides, Table, Text, Field), Fill & print Primary Action, Canvas Grid (10 px blueprint grid + Grid Settings), Layers Panel (Bill reference, Table 1 Items, Text 2 customer_name, Rectangle 1) (+5 more)

### Community 50 - "Tool Call Sample Records"
Cohesion: 0.15
Nodes (13): models, name, tool_call, name, tool_call, name, tool_call, name (+5 more)

### Community 51 - "Agent Model Roles"
Cohesion: 0.15
Nodes (13): name, name, name, name, name, auto, auto/cheap, auto/coding (+5 more)

### Community 52 - "OpenCode Model Providers"
Cohesion: 0.15
Nodes (13): name, name, deepseek/deepseek-v4-flash, deepseek/deepseek-v4-pro, qwen/qwen3.8-max, z-ai/glm-5.2, xkiro, name (+5 more)

### Community 53 - "NPM Scripts"
Cohesion: 0.15
Nodes (13): scripts, build, build:billkit, build:share, dev, fixture, lint, prepare:android-assets (+5 more)

### Community 54 - "Placeholders & Text Panel"
Cohesion: 0.33
Nodes (10): TextPanel(), analysePlaceholders(), collectDocumentVariables(), extractVariables(), hasVariable(), isDataFieldObject(), PlaceholderInfo, SUGGESTED_VARIABLES (+2 more)

### Community 55 - "Dynamic Form & Repeat Rows"
Cohesion: 0.27
Nodes (8): DynamicForm(), blankRow(), repeatValue(), rowsFromValue(), CHECKED_MARK, TICKMARK_OPTIONS, TemplateField, columns

### Community 56 - "Plan3 Wizard Screenshot"
Cohesion: 0.26
Nodes (12): Your Bill Photo Screenshot (Plan3), ACME Trading Co Invoice (Reference Photo), Bill Reference Layer, Bill Template Maker, Bill Template Wizard (Your bill -> Trace -> Mark data -> Test -> Save & share), Fill & Print Action, Visible 10 px Grid, Layers Panel (+4 more)

### Community 57 - "Trace Rectangle Inspector Screenshot"
Cohesion: 0.20
Nodes (12): Bill Photo Reference (ACME Trading Co), Bill Template Maker, Draw Tools Toolbar, Grid Overlay (10 px, Blueprint Style), Layers Panel (Bill reference, Rectangle 1), This Object Inspector, Rectangle 1 (Traced Object), Trace Step Rectangle Inspector Screenshot (+4 more)

### Community 58 - "Mark Data Fields Screenshot"
Cohesion: 0.20
Nodes (12): Bill Data Field Vocabulary (company_gstin, invoice_number, invoice_date, due_date, customer_name, customer_address, customer_gstin, item_no, item_name, item_description), Bill Template Maker - Trace Step UI, Canvas Text Selection Bound to customer_name, Document Panel (A4 794x1123 px, New Blank Document, Lock Structure), This Object Tab: Field Name Chips for Data Binding, Visible 10px Grid, Layers Panel (Bill reference, Text 2 - customer_name, Rectangle 1), Non-destructive Trace: Photo Never Exported, Sits at Bottom Layer (+4 more)

### Community 59 - "HTML Renderer Plan Tasks"
Cohesion: 0.18
Nodes (12): Generalized HTML Document Renderer Implementation Plan, Canonical JSON and SHA-256 (Task 2), Wire the HTML Document Export Target (Task 9), Freehand Path Data Fix (Task 1), Pure HTML Renderer (renderHtml), Golden Files and Purity Guard (Task 8), BillKit Package Phase 1-2 Implementation Plan, The .btpkg Format (+4 more)

### Community 60 - "Table Resize & Unification Plan"
Cohesion: 0.21
Nodes (12): Proportional Table Resize Implementation Plan, Canvas Image Conversion Viewport Gate, Shared Geometry Library (lib/geometry.ts), Largest Remainder Rounding, Snapshot-Based Resize, Canvas and Image Unification Spec, Reference Export-Leak Guard, Fabric-Bound Reference Image (+4 more)

### Community 61 - "Android Library & Format Plans"
Cohesion: 0.18
Nodes (12): Android Template Library Implementation Plan, feature:templates Module, Downloads Stored Under sha256 Filenames, Wiring the Existing Ktor Client, Open Stored Template Action, Feature Templates Screen, Shared Format Package Implementation Plan, BillKit Format Package (+4 more)

### Community 62 - "Snapshot & Part Capture API"
Cohesion: 0.18
Nodes (12): capturePart(), getSnapshot(), getTemplate(), getViewportSize(), openWith(), readBillPart(), readBillParts(), readLastBillPart() (+4 more)

### Community 65 - "Image Placeholder Object"
Cohesion: 0.24
Nodes (4): DEFAULT_IMAGE_PLACEHOLDER, ImagePlaceholderObject, ImagePlaceholderSpec, ImagePlaceholderRole

### Community 66 - "Money Spellout Words"
Cohesion: 0.23
Nodes (10): CURRENCY, CurrencyWords, GROUPS, groupWords(), ONES, spellMoney(), TENS, under100() (+2 more)

### Community 67 - "Expandable Bill E2E Test"
Cohesion: 0.20
Nodes (10): ADDRESS, Box, boxes(), BUNDLE, byId(), ORDER, parsed, ROOT (+2 more)

### Community 71 - "Free Model List (DeepSeek)"
Cohesion: 0.18
Nodes (11): name, name, deepseek-v4.1-flash:free, deepseek-v4-flash:free, qwen3.8-flash:free, tokenharbor, name, models (+3 more)

### Community 72 - "Vision-capable Model List"
Cohesion: 0.18
Nodes (11): name, name, name, name, deepseek-v4-flash, deepseek-v4-flash-vision-exp, glm-5.3-flash, hy3 (+3 more)

### Community 73 - "Layers & Stage Bar UI"
Cohesion: 0.20
Nodes (7): LayersPanel(), TYPE_GLYPH, StageBar(), IconButton(), EditorState, LayerEntry, GroupNode

### Community 74 - "Render Share Polish Spec"
Cohesion: 0.22
Nodes (10): Render Share and Rendering Polish Spec, Traced Colour Loss in HTML Output, Form Input Name Keys, Single-File Share Export, Slot-Owned Style Binding, Bill Template Maker README, DOCX Export as Flow Approximation, Manual Tracing (No OCR) (+2 more)

### Community 75 - "Editor E2E Helpers"
Cohesion: 0.29
Nodes (10): atZoom(), docToPage(), drawRect(), drawTwo(), openEditorWithBill(), pickTool(), seedRect(), selectAt() (+2 more)

### Community 76 - "Group Tree Helpers"
Cohesion: 0.44
Nodes (8): ancestorsOf(), byId(), canNest(), groupObjects(), groupOf(), pruneGroups(), subtreeIds(), ungroup()

### Community 77 - "Snapping Engine"
Cohesion: 0.29
Nodes (7): Best, bestOnAxis(), Edges, Levels, levelsFromBounds(), SnapLine, snapToLevels()

### Community 78 - "Package Validation Tests"
Cohesion: 0.31
Nodes (7): validatePackage(), archive(), issuesFor(), errorAt(), errors(), manifest(), pkg()

### Community 79 - "Free Model List (GLM)"
Cohesion: 0.20
Nodes (10): glm-5.3-flash:free, glm-5.3-flash-search:free, glm-5.3-flash-think-search:free, glm-5.3-flash-thinking:free, ling-3.0-flash-fin:free, unorouter-live, models, name (+2 more)

### Community 80 - "Layout Guides E2E Test"
Cohesion: 0.22
Nodes (5): BUNDLE, PAGE, ROOT, Run, TEMPLATE

### Community 81 - "Variable Layout E2E Test"
Cohesion: 0.22
Nodes (6): ADDRESS, AUTHORED, Box, BUNDLE, ROOT, TEMPLATE

### Community 83 - "DeepSeek Provider Config"
Cohesion: 0.22
Nodes (8): models, name, npm, name, deepseek-ai/DeepSeek-V4-Flash-0731, provider, dahlglobal, $schema

### Community 84 - "Claude Provider Config"
Cohesion: 0.22
Nodes (9): models, name, npm, options, name, name, claude-opus-4-8, claude-opus-5 (+1 more)

### Community 85 - "Package Allowlist Config"
Cohesion: 0.22
Nodes (8): allowScripts, canvas, core-js@3.50.0, esbuild@0.28.2, unrs-resolver@1.12.2, name, private, version

### Community 86 - "Variable Layout Bill Test"
Cohesion: 0.28
Nodes (7): FIXTURE, lineMeasurement(), LIVE, LONG, renderLines(), ROOT, template()

### Community 87 - "Editor UI Overview Screenshot"
Cohesion: 0.22
Nodes (9): ACME Trading Co Invoice Reference Image, Bill Template Maker UI, Design Canvas (794 x 1123 bill sheet), Document Panel (New blank document, Lock structure, 794 x 1123 px), Export Pipeline (JSON, SVG, PDF, DOCX, PNG), Grid Panel (visible 10 px, Grid Settings), Layers Panel (Bill reference layer, 0 objects), Reference Image Panel (opacity, whitening, removal) (+1 more)

### Community 88 - "Five-Step Workflow Screenshot"
Cohesion: 0.39
Nodes (8): Data field placeholder {{customer_name}}, Designer canvas with bill template, Field tool, Five-step template authoring workflow, Layers panel, Mark data step (step 3), Properties panel, Mark data step screenshot (Bill Template Maker)

### Community 89 - "BillKit Package E2E Test"
Cohesion: 0.36
Nodes (5): docToPage(), drawTableWithBand(), FIXTURE, markBand(), pickTool()

### Community 90 - "Test Bill Invoice Fixtures"
Cohesion: 0.36
Nodes (8): ACME Trading Co (invoice issuer/vendor), Gadget B (line item: qty 1, amount 250.00), ACME Trading Co Invoice (INV-1001) - test-bill.png, Invoice Date 2026-01-15, Invoice Number INV-1001, Jane Doe (bill-to customer), Subtotal/Total fields (labels rendered without values), Widget A (line item: qty 2, amount 100.00)

### Community 91 - "Table Guides E2E Test"
Cohesion: 0.36
Nodes (6): docToPage(), dragUntilGuided(), FIXTURE, guides(), pickTool(), seedRectAndTable()

### Community 92 - "Stroke Defaults"
Cohesion: 0.46
Nodes (5): applyStrokeFloor(), DEFAULT_STROKE_WIDTH, MIN_STROKE_DEVICE_PX, renderedStrokeWidth(), usesDefaultStroke()

### Community 93 - "Share Kit Bootstrapping"
Cohesion: 0.50
Nodes (6): bootShareKit(), buildField(), buildForm(), el(), FIELD_GROUPS, Window

### Community 94 - "Purity Guard Tests"
Cohesion: 0.25
Nodes (4): BANNED_AT_RUNTIME, BANNED_IN_CODE, root, VENDORED

### Community 95 - "UI Design Tokens"
Cohesion: 0.33
Nodes (4): PALETTE, PaletteToken, css, cssPath

### Community 96 - "Template Server Plan"
Cohesion: 0.33
Nodes (7): Template Server (Express) Implementation Plan, Catalog API (pocketbase-style list/get), Content-Addressed Storage, Byte-Equality Determinism Test, Deterministic Zip Output, Single Small Express Service, Validation Delegation to the Client

### Community 97 - "BillKit Package Spec"
Cohesion: 0.52
Nodes (7): BillKit Package Spec, Package Asset Directory, BillKit Package (.btpkg), Repeatable Line-Item Rows, Silent Template Import Failures, Missing Template Validation, Web-Locked Output Problem

### Community 98 - "Template Server Spec"
Cohesion: 0.48
Nodes (7): Template Server Spec, Template Admin Dashboard, Android Network and Storage Layer, Template Catalog and Discovery, Standalone Express Template Service, PackageReader Byte-Array Seam, prepare-android-assets Tool

### Community 99 - "Inspector E2E Test"
Cohesion: 0.38
Nodes (5): Btm, docToPage(), drawAndSelectRect(), FIXTURE, pickTool()

### Community 100 - "Atria Model Config"
Cohesion: 0.29
Nodes (7): name, models, name, npm, options, Atria-Dawn-Preview, atria

### Community 101 - "Wireframe Screen 4 Screenshot"
Cohesion: 0.47
Nodes (6): Primary Content Image Placeholder, Overlapping Card Panel, Greeking Placeholder Text Block, Screen 4 Wireframe, Sidebar Thumbnail Placeholder, Two-Column Screen Layout

### Community 102 - "Tinted Bill Fixture Image"
Cohesion: 0.53
Nodes (6): Tinted Bill (e2e invoice fixture), ACME Logo Block, INVOICE 2291 Header, Payment Reference Line, Tinted Cream Background, Total Due: 412.55

### Community 103 - "Row Heights E2E Test"
Cohesion: 0.33
Nodes (3): BUNDLE, ITEMS, ROOT

### Community 105 - "E2E Canvas Probe Helpers"
Cohesion: 0.33
Nodes (6): getCanvas(), getTable(), markerCounts(), strokeInk(), TableState, wheel()

### Community 106 - "BillKit Bridge Test"
Cohesion: 0.40
Nodes (3): bandedTemplate(), cell(), totals

### Community 107 - "Android Splash Screen Image"
Cohesion: 0.53
Nodes (6): android-home.png (Android App Splash Screen Screenshot), Android Robot Mascot Logo (White Bugdroid Head), Android Brand Green Palette (#3DDC84 Family) on White Background, Green Grid-Patterned Circular App Icon, Full-Screen White Splash / Launch State with Centered App Icon, Mobile System Status Bar (Time, Signal, Wi-Fi, Battery)

### Community 108 - "Field & Bill Part Tools Screenshot"
Cohesion: 0.33
Nodes (6): Bill Part Tool, Field Tool (semantic field on canvas), Fill & Render (primary action), {{token}} Placeholder Binding, Placeholders Panel ({{token}} mechanism), Properties Panel (empty-selection state)

### Community 109 - "Wireframe Screenshot 1"
Cohesion: 0.60
Nodes (5): Screenshot 1: Wireframe Template Mockup, Dashed Annotation Guide Lines, {field_1} Field Placeholder, Template Placeholder Field System, Wireframe Layout with Placeholder Fields

### Community 110 - "Wireframe Screenshot 3"
Cohesion: 0.40
Nodes (5): Screenshot 3: Low-Fidelity Wireframe Mockup, Media / Image Placeholder Boxes (Right Column), Page Frame / Viewport Border, Placeholder Text Block (Top-Left Panel), Two-Column Asymmetric Wireframe Layout Pattern

### Community 112 - "Guides Never Render Test"
Cohesion: 0.50
Nodes (4): CELL, table(), VALUES, variableTemplate()

### Community 113 - "Two-Column Panel Wireframe"
Cohesion: 0.67
Nodes (4): Asymmetric Panel Grid Pattern, Left Column Panel Stack, Right Column Panel Stack, Two-Column Wireframe Layout

### Community 114 - "Wireframe Screenshot 5"
Cohesion: 0.83
Nodes (4): Block-Based Content Page Layout Pattern, Empty Box Placeholders (4 rectangles), Gibberish Text Placeholder Block, Low-Fidelity Wireframe Layout (screenshot 5)

### Community 115 - "Long Bill Scroll Fixture"
Cohesion: 0.83
Nodes (4): BOTTOM OF PAGE Sentinel Label, long-bill.png - E2E long-scroll test fixture image, Incremental Line Markers (line 120 to line 2460, step 60), Scroll-to-Bottom Verification Test Pattern

### Community 116 - "Shared Template HTML Fixture"
Cohesion: 0.83
Nodes (4): Shared Template E2E Fixture, Embedded Share Template JSON, Live Preview Iframe, Share Kit Runtime (bootShareKit)

### Community 121 - "Astra Model Config"
Cohesion: 0.67
Nodes (3): models, name, gpt-6-astra

## Ambiguous Edges - Review These
- `5-Step Wizard (Your bill, Trace, Mark data, Test, Save & share)` → `This Object Tab: Field Name Chips for Data Binding`  [AMBIGUOUS]
  docs/screenshots/plan3/3-text-section.png · relation: conceptually_related_to

## Knowledge Gaps
- **440 isolated node(s):** `archivo`, `bitter`, `plexMono`, `metadata`, `NO_COMPUTED` (+435 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `5-Step Wizard (Your bill, Trace, Mark data, Test, Save & share)` and `This Object Tab: Field Name Chips for Data Binding`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `EditorController` connect `Editor Controller Lifecycle` to `Table Editing & Snapping`, `Layout Authoring Panel`, `Export Menu & Sharing`, `Context & Placeholder Panels`, `Tool Rail & Shortcuts`, `Selection Transforms & Cells`, `Template Loading & Fit`, `Viewport & Zoom`, `Render Page Client`, `App Shell & Editor Mount`, `Bill Part Cropping`, `Package Export & Round-Trip`, `Properties Panel Controls`, `Guides & Object Editing`, `Polygon & Drawing Tools`, `Shared Painting & Templates`, `Layers & Stage Bar UI`, `Keyboard Shortcuts & Tools`, `Drawing Finalization`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `g()` connect `BillKit Browser Bundle` to `ShareKit Browser Bundle`, `Group Tree Helpers`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `BillTemplate` connect `Render Page Client` to `Export Menu & Sharing`, `Canonicalization & Refusal Rules`, `Package Layout Metadata`, `Dynamic Form Derivation`, `Tool Rail & Shortcuts`, `Render Measurement Bridge`, `Package Writing & Hashing`, `Template Migration`, `Share Fixture Generator`, `Bill Field Model`, `Table Repeat & Types`, `Measurement & Row Heights`, `Template Serialization`, `Asset MIME Resolution`, `Template Loading & Fit`, `Package Build Pipeline`, `Data Binding & Field Extraction`, `App Shell & Editor Mount`, `Package Export & Round-Trip`, `Guide Attachment Tests`, `Shared Painting & Templates`, `Package Validation Tests`, `Variable Layout Bill Test`, `Share Kit Bootstrapping`, `BillKit Bridge Test`, `Guides Never Render Test`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `archivo`, `bitter`, `plexMono` to the rest of the system?**
  _440 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Table Editing & Snapping` be split into smaller, more focused modules?**
  _Cohesion score 0.056948798328108674 - nodes in this community are weakly interconnected._
- **Should `BillKit Browser Bundle` be split into smaller, more focused modules?**
  _Cohesion score 0.07737874861162532 - nodes in this community are weakly interconnected._