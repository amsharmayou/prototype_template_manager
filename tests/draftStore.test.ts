import { afterEach, describe, expect, it, vi } from "vitest";

import { clearDraft, loadDraft, saveDraft } from "@/lib/client/draftStore";
import { emptyTemplate } from "@/lib/template/types";

function localStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("local recovery drafts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves, validates, and clears a template draft", () => {
    vi.stubGlobal("window", { localStorage: localStorageMock() });
    const template = emptyTemplate(300, 400);

    expect(saveDraft("Draft bill", template)).toBe(true);
    expect(loadDraft()).toEqual(expect.objectContaining({ name: "Draft bill", template }));
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it("ignores malformed recovery data", () => {
    const storage = localStorageMock();
    storage.setItem("btm:recovery-draft", "not-json");
    vi.stubGlobal("window", { localStorage: storage });

    expect(loadDraft()).toBeNull();
  });
});
