import type { Prop, Template } from "@campuslife/shared/interiors";
import type { Kit } from "./kit";

export function legacyProp(kit: Kit, t: Template, p: Prop): boolean {
  const { x, y: z, w, d } = p;
  switch (p.type) {
    case "bed": {
      // Bunk bed: two mattresses, four posts, pillows to the north.
      for (const y0 of [0.38, 1.55]) {
        kit.box(0x4a5a6a, w, 0.1, d, x, y0, z);
        kit.box(0xdfe7ef, w - 0.08, 0.14, d - 0.1, x, y0 + 0.1, z);
        kit.box(0xffffff, w - 0.3, 0.1, 0.35, x, y0 + 0.24, z - d / 2 + 0.25);
      }
      kit.box(0x2f6db0, w - 0.06, 0.03, d * 0.55, x, 0.62, z + d * 0.18); // blanket
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.box(0x3a4a5a, 0.06, 2.0, 0.06, x + lx * (w / 2 - 0.03), 0, z + lz * (d / 2 - 0.03));
      break;
    }
    case "shelf": {
      kit.box(0x5a3e28, w, 1.95, d, x, 0, z);
      const books = [0x8e2b2b, 0x2b4f8e, 0x2b8e5a, 0xc29a2b, 0x6b2b8e];
      for (let shelfY = 0.15; shelfY < 1.8; shelfY += 0.45)
        for (let bx = -w / 2 + 0.2; bx < w / 2 - 0.2; bx += 0.7)
          kit.box(books[Math.abs(Math.round(bx * 7 + shelfY * 13)) % books.length], 0.6, 0.32, d + 0.04, x + bx + 0.3, shelfY, z);
      break;
    }
    case "couch": {
      const bx = x - Math.cos(p.face ?? 0) * (Math.min(w, d) / 2 - 0.12);
      const bz = z - Math.sin(p.face ?? 0) * (Math.min(w, d) / 2 - 0.12);
      kit.box(0x7a4a32, w, 0.42, d, x, 0, z);
      kit.box(0x8a5a40, w, 0.12, d, x, 0.42, z);
      const across = Math.abs(Math.cos(p.face ?? 0)) > 0.5;
      kit.box(0x6a3a28, across ? 0.2 : w, 0.5, across ? d : 0.2, bx, 0.42, bz, 0);
      break;
    }
    case "tv": {
      const across = Math.abs(Math.cos(p.face ?? 0)) > 0.5;
      kit.box(0x111111, across ? 0.08 : w, 1.1, across ? d : 0.08, x, 1.2, z);
      kit.box(0x3a6ea5, across ? 0.02 : w - 0.1, 0.95, across ? d - 0.1 : 0.02, x - Math.cos(p.face ?? 0) * -0.05, 1.27, z, 0, { emissive: 0x1d4f7a });
      break;
    }
    case "atm":
      kit.box(0x2b3a4a, w, 1.7, d, x, 0, z);
      kit.box(0x5fb0e0, 0.02, 0.35, 0.45, x + w / 2, 1.15, z, 0, { emissive: 0x2a6a90 });
      break;
    case "mat":
      kit.box(p.color ?? 0x9b2c2c, w, 0.015, d, x, 0.012, z);
      break;
    case "rug":
      kit.box(0x8a3a2a, w, 0.012, d, x, 0.012, z);
      break;
    case "plant":
      // Water dispenser (a fixture of every Nigerian office and hall lobby).
      kit.box(0xe8e8e8, 0.4, 1.0, 0.4, x, 0, z);
      kit.box(0x7fb8e6, 0.3, 0.42, 0.3, x, 1.0, z, 0, { transparent: true, opacity: 0.8 });
      break;
    case "snooker":
      kit.box(0x5a3a22, w, 0.75, d, x, 0, z);
      kit.box(0x1f7a3a, w - 0.2, 0.04, d - 0.2, x, 0.75, z);
      break;
    case "vending":
      kit.box(0xb3261e, w, 1.85, d, x, 0, z);
      kit.box(0x9fd3f0, 0.02, 1.2, d - 0.3, x - w / 2, 0.5, z, 0, { emissive: 0x335566 });
      break;
    case "court":
      kit.box(0xb5302a, w, 0.012, 0.08, x, 0.015, z - d / 2);
      kit.box(0xb5302a, w, 0.012, 0.08, x, 0.015, z + d / 2);
      kit.box(0xb5302a, 0.08, 0.012, d, x - w / 2, 0.015, z);
      kit.box(0xb5302a, 0.08, 0.012, d, x + w / 2, 0.015, z);
      kit.box(0xb5302a, 0.08, 0.012, d, x, 0.015, z);
      break;
    case "pew":
      // Wooden bench with a backrest on its south side.
      kit.box(0x6b4226, w, 0.08, d * 0.7, x, 0.42, z - d * 0.15);
      kit.box(0x5a3620, w, 0.5, 0.08, x, 0.42, z + d / 2 - 0.04);
      kit.box(0x4a2c1a, w - 0.2, 0.42, 0.06, x, 0, z);
      break;
    case "altar":
      kit.box(0xf4f1ea, w, 0.25, d, x, 0, z); // step
      kit.box(0xffffff, w * 0.5, 1.0, d * 0.45, x, 0.25, z); // table
      kit.box(0xc9a227, 0.08, 0.8, 0.08, x, 1.25, z); // cross (upright)
      kit.box(0xc9a227, 0.45, 0.08, 0.08, x, 1.75, z); // cross (bar)
      break;
    case "dancefloor": {
      // Checkered light-up floor.
      const cols = [0x7c3aed, 0xdb2777, 0x2563eb, 0x16a34a];
      for (let ix = 0; ix < 4; ix++)
        for (let iz = 0; iz < 4; iz++)
          kit.box(cols[(ix + iz) % 4], w / 4 - 0.05, 0.02, d / 4 - 0.05, x - w / 2 + (w / 4) * (ix + 0.5), 0.012, z - d / 2 + (d / 4) * (iz + 0.5), 0, { emissive: cols[(ix + iz) % 4], emissiveIntensity: 0.35 });
      break;
    }
    case "dj":
      kit.box(0x1f2937, w, 1.05, d, x, 0, z);
      kit.box(0x111827, w * 0.9, 0.05, d * 0.8, x, 1.05, z);
      for (const sx of [-w / 2 - 0.4, w / 2 + 0.4]) kit.box(0x0f0f0f, 0.6, 1.5, 0.6, x + sx, 0, z); // speakers
      break;
    case "partition":
      kit.box(t.wall, w, 2.4, d, x, 0, z);
      break;
    case "counter":
      kit.box(0x7b4f2c, w, 1.0, d, x, 0, z);
      kit.box(0xd9cfc0, w + 0.06, 0.06, d + 0.1, x, 1.0, z);
      break;
    case "table":
      kit.box(0x8a6440, w, 0.05, d, x, 0.72, z);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.box(0x5a4030, 0.06, 0.72, 0.06, x + lx * (w / 2 - 0.08), 0, z + lz * (d / 2 - 0.08));
      break;
    case "desk":
      kit.box(0x9a7a55, w, 0.05, d, x, 0.73, z);
      kit.box(0x6f5538, w - 0.1, 0.7, 0.04, x, 0.03, z - d / 2 + 0.05);
      break;
    case "bench":
      kit.box(0x8a6a48, w, 0.06, d, x, 0.42, z);
      kit.box(0x5a4030, w - 0.2, 0.42, 0.06, x, 0, z);
      break;
    default:
      return false;
  }
  return true;
}
