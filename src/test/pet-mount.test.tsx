import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `import.meta.url` di bawah transform Vite bukan URL ber-skema `file:`, jadi berkasnya dicari
// dari cwd — yang berbeda antara run tingkat-paket (`src/`) dan tingkat-root (cermin
// `changelog-nav.test.tsx`).
function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((c) => existsSync(c));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

const app = read("src/App.tsx");

describe("mount pet Hanoman di App", () => {
  it("dipasang tepat sekali", () => {
    expect(app.match(/<HanomanPet\b/g)).toHaveLength(1);
    expect(app).toContain('import { HanomanPet } from "./screens/HanomanPet"');
  });

  it("dipasang di App, bukan di dalam Shell — Shell ditulis ulang tiap cabang section", () => {
    expect(read("src/ds/shell.tsx")).not.toContain("HanomanPet");
  });

  it("diberi kedua sumber datanya dan callback navigasi", () => {
    const at = app.indexOf("<HanomanPet");
    const tag = app.slice(at, at + 400);
    expect(tag).toContain("sessions={sessions}");
    expect(tag).toContain("backlog={backlog}");
    expect(tag).toContain("onOpen=");
  });
});

describe("kontrak design system pet", () => {
  it("tak memperkenalkan warna atau bayangan di luar token", () => {
    const pet = read("src/screens/HanomanPet.tsx");
    expect(pet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(pet).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(pet).not.toMatch(/boxShadow:\s*["'](?!var\()/);
  });

  it("artwork pet datang dari atlas PET-001 lewat manifest, bukan sticker STK per pose", () => {
    const petState = read("src/screens/pet-state.ts");
    expect(petState).not.toContain(".webp");
    expect(petState).not.toMatch(/STK-00\d/);
    const sprite = read("src/screens/pet-sprite.ts");
    expect(sprite).toContain('from "../../../internal/assets/pet/pet.json"');
    expect(sprite).toContain('from "../../../internal/assets/pet/hnm-pet-anoman-atlas-v02.webp?url"');
    expect(read("src/screens/HanomanPet.tsx")).not.toContain("StickerIllustration");
  });
});
