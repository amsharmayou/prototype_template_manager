/**
 * Draws a small, plausible paper bill so the app can be tried before the
 * person finds their own photo. Pure canvas, nothing leaves the browser.
 */
export function renderSampleBill(): string {
  const width = 720;
  const height = 960;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser did not provide a drawing canvas.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1a1a1a";
  ctx.strokeStyle = "#1a1a1a";

  // Shop header
  ctx.font = "bold 34px Georgia, serif";
  ctx.fillText("RIVERSTONE HARDWARE", 48, 88);
  ctx.font = "16px Georgia, serif";
  ctx.fillText("14 Mill Lane · Open 7 days", 48, 116);

  // Bill meta
  ctx.font = "16px Georgia, serif";
  ctx.fillText("Receipt #", 448, 88);
  ctx.fillText("Date", 448, 116);
  ctx.font = "16px monospace";
  ctx.fillText("10842", 560, 88);
  ctx.fillText("14 Oct 2026", 560, 116);

  ctx.beginPath();
  ctx.moveTo(48, 144);
  ctx.lineTo(672, 144);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Column headings
  ctx.font = "bold 15px Georgia, serif";
  ctx.fillText("Item", 48, 176);
  ctx.fillText("Qty", 440, 176);
  ctx.fillText("Price", 512, 176);
  ctx.fillText("Amount", 596, 176);

  // Line items
  const items: Array<[string, string, string, string]> = [
    ["Galvanised nails, 50mm", "2", "6.40", "12.80"],
    ["Wood screws, 30mm", "1", "8.95", "8.95"],
    ["Hinge, brass 75mm", "4", "3.20", "12.80"],
    ["Wood glue 250ml", "1", "7.50", "7.50"],
    ["Sandpaper sheets", "6", "0.95", "5.70"],
  ];
  ctx.font = "15px Georgia, serif";
  let y = 212;
  for (const [item, qty, price, amount] of items) {
    ctx.fillText(item, 48, y);
    ctx.fillText(qty, 440, y);
    ctx.fillText(price, 512, y);
    ctx.fillText(amount, 596, y);
    y += 34;
  }

  ctx.beginPath();
  ctx.moveTo(48, y + 8);
  ctx.lineTo(672, y + 8);
  ctx.lineWidth = 1;
  ctx.stroke();
  y += 44;

  // Totals block
  ctx.font = "15px Georgia, serif";
  ctx.fillText("Subtotal", 448, y);
  ctx.fillText("47.75", 596, y);
  ctx.fillText("Tax 8%", 448, y + 28);
  ctx.fillText("3.82", 596, y + 28);
  ctx.font = "bold 18px Georgia, serif";
  ctx.fillText("TOTAL", 448, y + 64);
  ctx.fillText("51.57", 596, y + 64);

  ctx.beginPath();
  ctx.moveTo(440, y + 76);
  ctx.lineTo(672, y + 76);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Stamp box, bottom right
  ctx.lineWidth = 1.5;
  ctx.strokeRect(512, y + 120, 160, 96);
  ctx.font = "14px Georgia, serif";
  ctx.fillText("PAID", 566, y + 174);

  ctx.font = "13px Georgia, serif";
  ctx.fillText("Thank you — please keep this receipt.", 48, height - 48);

  return canvas.toDataURL("image/png");
}
