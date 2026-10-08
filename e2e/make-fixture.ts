/**
 * Generates the sample bill used by the end-to-end test.
 * Kept as a script so the fixture is reproducible and reviewable.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const W = 794;
const H = 1123;
/** A deliberately long receipt, to exercise scrolling to the lower page. */
const LONG_W = 794;
const LONG_H = 2600;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const dataUrl = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d")!;
      x.fillStyle = "#fff";
      x.fillRect(0, 0, w, h);
      x.strokeStyle = "#000";
      x.lineWidth = 2;
      x.strokeRect(30, 30, w - 60, h - 60);
      x.beginPath();
      x.moveTo(30, 200);
      x.lineTo(w - 30, 200);
      x.stroke();
      x.beginPath();
      x.moveTo(30, 300);
      x.lineTo(430, 300);
      x.stroke();
      x.beginPath();
      x.moveTo(30, 420);
      x.lineTo(w - 30, 420);
      x.stroke();
      x.beginPath();
      x.moveTo(430, 200);
      x.lineTo(430, 420);
      x.stroke();
      x.fillStyle = "#000";
      x.font = "bold 28px Arial";
      x.fillText("ACME TRADING CO.", 60, 100);
      x.font = "22px Arial";
      x.fillText("INVOICE", 320, 100);
      x.font = "14px Arial";
      x.fillText("Invoice No: INV-1001", 60, 240);
      x.fillText("Date: 2026-01-15", 60, 270);
      x.fillText("Bill To: Jane Doe", 460, 240);
      x.font = "bold 13px Arial";
      x.fillText("No", 50, 450);
      x.fillText("Description", 120, 450);
      x.fillText("Qty", 520, 450);
      x.fillText("Amount", 620, 450);
      x.font = "13px Arial";
      x.fillText("1", 50, 490);
      x.fillText("Widget A", 120, 490);
      x.fillText("2", 520, 490);
      x.fillText("100.00", 620, 490);
      x.fillText("2", 50, 530);
      x.fillText("Gadget B", 120, 530);
      x.fillText("1", 520, 530);
      x.fillText("250.00", 620, 530);
      x.font = "bold 15px Arial";
      x.fillText("Subtotal:", 460, 620);
      x.fillText("Total:", 460, 680);
      x.font = "13px Arial";
      x.fillText("Thank you for your business", 60, 1000);
      return c.toDataURL("image/png");
    },
    { w: W, h: H },
  );

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const out = join(process.cwd(), "e2e", "fixtures", "test-bill.png");
  writeFileSync(out, Buffer.from(base64, "base64"));

  // Long page fixture.
  const longUrl = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d")!;
      x.fillStyle = "#fff";
      x.fillRect(0, 0, w, h);
      x.strokeStyle = "#000";
      x.lineWidth = 2;
      x.strokeRect(30, 30, w - 60, h - 60);
      for (let y = 120; y < h - 80; y += 60) {
        x.beginPath();
        x.moveTo(40, y);
        x.lineTo(w - 40, y);
        x.stroke();
        x.fillStyle = "#000";
        x.font = "12px Arial";
        x.fillText(`line ${y}`, 50, y - 10);
      }
      x.fillStyle = "#000";
      x.font = "bold 20px Arial";
      x.fillText("BOTTOM OF PAGE", 40, h - 50);
      return c.toDataURL("image/png");
    },
    { w: LONG_W, h: LONG_H },
  );
  writeFileSync(
    join(process.cwd(), "e2e", "fixtures", "long-bill.png"),
    Buffer.from(longUrl.replace(/^data:image\/png;base64,/, ""), "base64"),
  );

  // Tinted-paper fixture, used only by the bill-part tests. Its background is
  // deliberately NOT white (#f2ece0 cream), because a white page would make the
  // background normalization indistinguishable from a no-op: the crop would
  // already be white. The dark "logo" block is enclosed by the cream paper, so
  // the border-connected flood fill has something it must refuse to erase.
  const tintedUrl = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d")!;
      x.fillStyle = "#f2ece0";
      x.fillRect(0, 0, w, h);

      // A dark logo, plus ink inside it, well away from the crop border so the
      // normalization assertions can prove the content survived.
      x.fillStyle = "#7a1f1f";
      x.fillRect(40, 40, 300, 180);
      x.fillStyle = "#ffffff";
      x.font = "bold 30px Arial";
      x.fillText("ACME", 60, 110);
      x.font = "16px Arial";
      x.fillText("Logo block", 60, 150);

      // Ink on the cream paper, inside the region the tests will cut.
      x.fillStyle = "#20242a";
      x.font = "bold 26px Arial";
      x.fillText("INVOICE 2291", 40, 300);
      x.font = "15px Arial";
      x.fillText("Total due: 412.55", 40, 340);
      x.fillText("Payment reference", 40, 370);
      x.strokeStyle = "#3a4048";
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(40, 395);
      x.lineTo(700, 395);
      x.stroke();
      return c.toDataURL("image/png");
    },
    { w: W, h: H },
  );
  const tintedOut = join(process.cwd(), "e2e", "fixtures", "tinted-bill.png");
  writeFileSync(
    tintedOut,
    Buffer.from(tintedUrl.replace(/^data:image\/png;base64,/, ""), "base64"),
  );

  await browser.close();
  process.stdout.write(`wrote ${out}, long-bill.png and ${tintedOut}\n`);
}

void main();
