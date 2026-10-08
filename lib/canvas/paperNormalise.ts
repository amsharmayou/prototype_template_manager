const clampChannel = (n: number): number =>
  Math.min(255, Math.max(0, Math.round(n)));

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function distance(
  a: [number, number, number],
  b: [number, number, number],
  i: number,
  data: Uint8ClampedArray,
): number {
  const dr = a[0] - data[i]!;
  const dg = a[1] - data[i + 1]!;
  const db = a[2] - data[i + 2]!;
  return Math.sqrt(dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114);
}

export function estimatePaperColour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = pixelAt(data, width, x, y);
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const i = pixelAt(data, width, x, y);
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  return n === 0 ? [255, 255, 255] : [clampChannel(r / n), clampChannel(g / n), clampChannel(b / n)];
}

export function normalisePaper(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const paper = estimatePaperColour(data, width, height);
  const visited = new Uint8Array(width * height);
  const queue: Array<[number, number]> = [];
  const max = 54;
  for (let x = 0; x < width; x++) {
    queue.push([x, 0], [x, height - 1]);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push([0, y], [width - 1, y]);
  }

  const canReplace = (x: number, y: number): boolean => {
    const i = pixelAt(data, width, x, y);
    const d = distance(paper, paper, i, data);
    return d < max;
  };

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const index = y * width + x;
    if (visited[index]) continue;
    visited[index] = 1;
    if (!canReplace(x, y)) continue;
    const i = pixelAt(data, width, x, y);
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
}
