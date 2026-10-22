import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Source of a repo-relative file, read fresh per call. */
const source = (rel: string): string =>
  readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("PropertiesPanel copy", () => {
  const src = source("components/editor/PropertiesPanel.tsx");

  it("no longer speaks in engineering vocabulary", () => {
    expect(src).not.toContain('title="Object"');
    expect(src).not.toContain('title="Appearance"');
    expect(src).not.toContain('title="Bill Part"');
    expect(src).not.toContain('title="Align"');
    expect(src).not.toContain('title="Image Placeholder"');
    expect(src).not.toContain('title="Field"');
    expect(src).not.toContain('label="Role"');
    expect(src).not.toContain('label="Stroke"');
    expect(src).not.toContain('label="Stroke width"');
    expect(src).not.toContain('label="Fill"');
    expect(src).not.toContain('label="Weight"');
    expect(src).not.toContain('label="Style"');
    expect(src).not.toContain('label="Align"');
    expect(src).not.toContain('label="Custom family"');
    expect(src).not.toContain('label="Insert variable"');
    expect(src).not.toContain('label="Wrap"');
    expect(src).not.toContain("Kind:");
    expect(src).not.toContain("(mixed)");
    expect(src).not.toContain("Recapture from current position");
    expect(src).not.toContain('label="Whiten paper"');
    expect(src).not.toContain('label="Border colour"');
    expect(src).not.toContain('label="Border width"');
    expect(src).not.toContain('label="Cell fill"');
    expect(src).not.toContain('label="Padding"');
    expect(src).not.toContain('label="Header fill"');
    expect(src).not.toContain("First row");
    expect(src).not.toContain("Last row");
    expect(src).not.toContain("Items key");
    expect(src).not.toContain("Max items");
    expect(src).not.toContain("Repeat header when split");
    expect(src).not.toContain("Cell contents");
    expect(src).not.toContain("Distribute H");
    expect(src).not.toContain("Distribute V");
    expect(src).not.toContain("semantic");
  });

  it("uses the owner's words instead", () => {
    expect(src).toContain('title="This object"');
    expect(src).toContain('title="Ink & outline"');
    expect(src).toContain('title="Cut-out picture"');
    expect(src).toContain('title="Line up"');
    expect(src).toContain('title="Picture slot"');
    expect(src).toContain('title="Data field"');
    expect(src).toContain('label="Line colour"');
    expect(src).toContain('label="Line thickness"');
    expect(src).toContain('label="Fill colour"');
    expect(src).toContain("What this is");
    expect(src).toContain("Bold &amp; italic");
    expect(src).toContain('label="Alignment"');
    expect(src).toContain('label="Custom font"');
    expect(src).toContain('label="Insert a variable"');
    expect(src).toContain("Let the text wrap onto more lines");
    expect(src).toContain("This fills from");
    expect(src).toContain('label="Clean the paper to white"');
    expect(src).toContain("Take it again from the photo");
    expect(src).toContain('label="What goes here"');
    expect(src).toContain("Space evenly (H)");
    expect(src).toContain("Space evenly (V)");
    expect(src).toContain("From row");
    expect(src).toContain("To row");
    expect(src).toContain("Data name");
    expect(src).toContain("Cell text");
    expect(src).toContain("Nothing selected yet");
  });

  it("keeps the strings the e2e suite and the round-trip test rely on", () => {
    expect(src).toContain("Repeat these rows once per item");
    expect(src).toContain('label="Locked"');
    expect(src).toContain('label="Visible"');
    expect(src).toContain('label="Font"');
    expect(src).toContain('label="Name"');
    expect(src).toContain("Fixed text");
  });
});

describe("LayoutPanel copy", () => {
  const src = source("components/editor/LayoutPanel.tsx");

  it("no longer speaks in engineering vocabulary", () => {
    expect(src).not.toContain("Variable layout");
    expect(src).not.toContain("Fixed size");
    expect(src).not.toContain("Expand as needed");
    expect(src).not.toContain("Expand, with a limit");
    expect(src).not.toContain("Maximum extra");
    expect(src).not.toContain("Wrap within width");
    expect(src).not.toContain("pushes guide");
    expect(src).not.toContain("Move with guide");
    expect(src).not.toContain("Stretch with guide");
    expect(src).not.toContain("Layout parent");
    expect(src).not.toContain("No parent");
    expect(src).not.toContain("Plain frame");
    expect(src).not.toContain("Layout container");
    expect(src).not.toContain("Grow around children");
    expect(src).not.toContain("Inside padding");
    expect(src).not.toContain("Size limits");
    expect(src).not.toContain("Min width");
    expect(src).not.toContain("Max width");
    expect(src).not.toContain("Min height");
    expect(src).not.toContain("Max height");
    expect(src).not.toContain("Fixed page");
    expect(src).not.toContain("Let page grow");
    expect(src).not.toContain("Max page");
    expect(src).not.toContain("Sibling overlap");
    expect(src).not.toContain("Report overlap");
    expect(src).not.toContain("Allow overlap");
    expect(src).not.toContain("Max travel");
  });

  it("uses the owner's words instead", () => {
    expect(src).toContain('title="When data is longer"');
    expect(src).toContain('title="What moves with this"');
    expect(src).toContain('title="Inside its frame"');
    expect(src).toContain('title="The page"');
    expect(src).toContain("Guide lines (");
    expect(src).toContain("Stop growing after (px)");
    expect(src).toContain("Which line moves with it");
    expect(src).toContain("Follow along without changing size");
    expect(src).toContain("Stretch to keep touching");
    expect(src).toContain("What the top edge follows");
    expect(src).toContain("Which frame holds it");
    expect(src).toContain("Not in a frame");
    expect(src).toContain("Shrink-wrap the frame around its contents");
    expect(src).toContain("Around its contents");
    expect(src).toContain("Keep the same size");
    expect(src).toContain("Smallest / largest size (px)");
    expect(src).toContain("Smallest width");
    expect(src).toContain("Largest height");
    expect(src).toContain("Keep the paper size");
    expect(src).toContain("Let the page grow");
    expect(src).toContain("Largest page width");
    expect(src).toContain("If objects overlap");
    expect(src).toContain("Warn me");
    expect(src).toContain("Leave it");
    expect(src).toContain("How far this line can move");
    expect(src).toContain("Keep the left edge");
    expect(src).toContain("Stretch with the frame");
  });
});

describe("context panel copy", () => {
  it("the reference panel talks about the photo", () => {
    const src = source("components/editor/ReferencePanel.tsx");
    expect(src).not.toContain('title="Reference Image"');
    expect(src).not.toContain("No reference loaded");
    expect(src).toContain('title="Your bill photo"');
    expect(src).toContain("No photo loaded yet");
    expect(src).toContain("Remove Reference");
    expect(src).toContain("Whiten paper on new parts");
    expect(src).toContain("Show reference");
  });

  it("the data fields panel talks about answers", () => {
    const src = source("components/editor/PlaceholdersPanel.tsx");
    expect(src).not.toContain('title="Placeholders"');
    expect(src).not.toContain('label="Input type"');
    expect(src).not.toContain('label="Max length"');
    expect(src).not.toContain('label="Printed style"');
    expect(src).toContain('title="Data fields"');
    expect(src).toContain('label="Type of answer"');
    expect(src).toContain('label="Maximum length"');
    expect(src).toContain('label="How it prints"');
    expect(src).toContain("Picture slots always ask for a picture.");
    expect(src).toContain("Form label");
  });
});
