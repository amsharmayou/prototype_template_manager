import { describe, expect, it } from "vitest";
import { estimatePaperColour, normalisePaper } from "@/lib/canvas/paperNormalise";

function rgb(data: Uint8ClampedArray, index: number): [number, number, number] {
  return [data[index * 4]!, data[index * 4 + 1]!, data[index * 4 + 2]!];
}

describe("estimatePaperColour", () => {
  it("uses the border tint", () => {
    const data = new Uint8ClampedArray(16);
    for (let i = 0; i < 4; i++) data.set([238, 226, 200, 255], i * 4);
    expect(estimatePaperColour(data, 2, 2)).toEqual([238, 226, 200]);
  });
});

describe("normalisePaper", () => {
  it("turns border-connected tinted paper white and keeps content", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([238, 226, 200, 255], i * 4);
    data.set([0, 0, 0, 255], (1 * width + 1) * 4);
    data.set([10, 90, 200, 255], (2 * width + 2) * 4);

    normalisePaper(data, width, height);

    expect(rgb(data, 0)).toEqual([255, 255, 255]);
    expect(rgb(data, 1 * width + 1)).toEqual([0, 0, 0]);
    expect(rgb(data, 2 * width + 2)).toEqual([10, 90, 200]);
  });

  it("does not recolour an enclosed patch that never connects to the border", () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([238, 226, 200, 255], i * 4);
    for (let y = 1; y < 4; y++) data.set([30, 30, 30, 255], (y * width + 1) * 4);
    for (let x = 1; x < 4; x++) data.set([30, 30, 30, 255], (1 * width + x) * 4);
    for (let x = 1; x < 4; x++) data.set([30, 30, 30, 255], (3 * width + x) * 4);
    for (let y = 1; y < 4; y++) data.set([30, 30, 30, 255], (y * width + 3) * 4);
    data.set([238, 226, 200, 255], (2 * width + 2) * 4);

    normalisePaper(data, width, height);

    expect(rgb(data, 0)).toEqual([255, 255, 255]);
    expect(rgb(data, 2 * width + 2)).toEqual([238, 226, 200]);
  });
});
