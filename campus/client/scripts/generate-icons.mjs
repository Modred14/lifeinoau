import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "public/brand/campus-life-icon-v2.png");
const outputs = [
  { size: 192, scale: 0.9, file: "public/icons/icon-192.png" },
  { size: 512, scale: 0.9, file: "public/icons/icon-512.png" },
  { size: 192, scale: 0.68, file: "public/icons/maskable-192.png" },
  { size: 512, scale: 0.68, file: "public/icons/maskable-512.png" },
  { size: 180, scale: 0.78, file: "app/apple-icon.png" },
  { size: 64, scale: 0.9, file: "app/icon.png" },
];

for (const { size, scale, file } of outputs) {
  const mark = await sharp(source).resize(Math.round(size * scale)).toBuffer();
  const out = path.join(root, file);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: "#182b23" } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log("wrote", file);
}
