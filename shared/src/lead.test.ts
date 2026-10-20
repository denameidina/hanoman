import { describe, it, expect } from "vitest";
import {
  LEAD_ACTIONS, LEAD_FORBIDDEN, leadActionAllowed, leadRefusalReason,
  isWeightyDecision, zLeadVerdict, zLeadAsk,
  resolveChoice, clampProse, optionActionHint, leadReplyText,
  LEAD_DECISION_MAX, LEAD_REASON_MAX,
  normalizeSelect, resolveChoices, checkChoiceCount, zLeadFlowStatus, LEAD_FLOW_OPEN,
} from "./lead";
import { zLead, LEAD_DEFAULTS, zSetting } from "./entities";
import { CAPABILITY_IDS, grantsCapability } from "./agent";

describe("SPEC-409 · permukaan tindakan lead (AC-31/32/34)", () => {
  it("is an allowlist: anything not listed is locked", () => {
    expect(leadActionAllowed("integrate-main")).toBe(true);
    expect(leadActionAllowed("deploy")).toBe(false);
    expect(leadActionAllowed("rm -rf /")).toBe(false);
    expect(leadActionAllowed("")).toBe(false);
  });
  // Test niat, bukan sekadar isi: allowlist yang kelak bertambah satu entri berbahaya akan
  // menabrak assert ini alih-alih lolos diam-diam.
  it("never lets a forbidden action into the allowlist", () => {
    for (const forbidden of Object.keys(LEAD_FORBIDDEN)) {
      expect(LEAD_ACTIONS as readonly string[]).not.toContain(forbidden);
      expect(leadActionAllowed(forbidden)).toBe(false);
    }
  });
  it("names every locked action in plain language, including unknown ones", () => {
    expect(leadRefusalReason("deploy")).toContain("produksi");
    expect(leadRefusalReason("vps-console")).toContain("VPS");
    expect(leadRefusalReason("delete-decision")).toContain("jejak keputusan");
    expect(leadRefusalReason("sesuatu-yang-baru")).toContain("di luar permukaan tindakan lead");
  });
  it("has no action that deletes anything", () => {
    for (const a of LEAD_ACTIONS) expect(a.startsWith("delete")).toBe(false);
  });
});

describe("SPEC-409 · putusan berbobot (AC-25, OQ-5)", () => {
  const base = { kind: "answer", action: "none", confidence: "tinggi" } as const;
  it("is quiet for an ordinary confident answer", () => {
    expect(isWeightyDecision(base)).toBe(false);
  });
  it("fires on doubt regardless of anything else", () => {
    expect(isWeightyDecision({ ...base, confidence: "ragu" })).toBe(true);
  });
  it("fires on hard-to-undo actions", () => {
    for (const action of ["integrate-main", "run-migration", "stop-session", "restart-session"] as const) {
      expect(isWeightyDecision({ ...base, action })).toBe(true);
    }
  });
  it("fires on collisions and refusals", () => {
    expect(isWeightyDecision({ ...base, kind: "collision" })).toBe(true);
    expect(isWeightyDecision({ ...base, kind: "refusal" })).toBe(true);
  });
  it("stays quiet for reversible actions", () => {
    for (const action of ["answer-session", "order-queue", "resume-session", "hold-work"] as const) {
      expect(isWeightyDecision({ ...base, action })).toBe(false);
    }
  });
});

describe("SPEC-409 · bentuk jawaban (AC-1)", () => {
  it("fills sane defaults so a terse-but-valid verdict is still usable", () => {
    const v = zLeadVerdict.parse({ decision: "pakai opsi 1", reason: "ADR-0029" });
    expect(v).toEqual({
      decision: "pakai opsi 1", reason: "ADR-0029", refs: [], confidence: "sedang",
      action: "none", reply: "", choice: "", choices: [], missing: [],
    });
  });
  it("rejects a verdict without a decision or a reason", () => {
    expect(zLeadVerdict.safeParse({ decision: "", reason: "x" }).success).toBe(false);
    expect(zLeadVerdict.safeParse({ decision: "x" }).success).toBe(false);
  });
  // Yang bikin ini penting: kalau enum menyaring `action` di sini, permintaan "deploy" hanya akan
  // tampak sebagai keluaran rusak — dan justru peristiwa paling layak dilaporkan (AC-33) hilang.
  it("lets a forbidden action through parsing so the server can refuse it on the record", () => {
    const v = zLeadVerdict.parse({ decision: "d", reason: "r", action: "deploy" });
    expect(v.action).toBe("deploy");
    expect(leadActionAllowed(v.action)).toBe(false);
  });
});

describe("SPEC-409 · knob lead (AC-30)", () => {
  it("is off by default in every dimension that can act", () => {
    expect(LEAD_DEFAULTS.enabled).toBe(false);
    expect(LEAD_DEFAULTS.paused).toBe(false);
    expect(LEAD_DEFAULTS.pausedProjects).toEqual([]);
    expect(LEAD_DEFAULTS.engine.enabled).toBe(false);   // warisi sessionAgentDefaults()
  });
  it("keeps an objective gate before integrating to main by default (OQ-3)", () => {
    expect(LEAD_DEFAULTS.requireGreenBeforeIntegrate).toBe(true);
  });
  it("caps consecutive auto-answers per session (AC-11 / OQ-10)", () => {
    expect(LEAD_DEFAULTS.maxAutoAnswers).toBe(3);
  });
  // Baris Setting yang ditulis sebelum SPEC-409 tak punya blok ini sama sekali; tanpa .default()
  // seluruh layar Settings jatuh ke DEFAULT_SETTING dan setelan operator lenyap dari tampilan.
  it("parses a pre-SPEC-409 Setting row without the block", () => {
    const parsed = zSetting.parse({
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
    });
    expect(parsed.lead).toEqual(LEAD_DEFAULTS);
  });
  it("rejects a heartbeat faster than a minute", () => {
    expect(zLead.safeParse({ everyMin: 0 }).success).toBe(false);
  });
});

// ADR-0228 · knob brain (`timeoutSec`, `maxConcurrent`, `queueWaitSec`) dicabut. Menunggu tetap
// punya ujung — kini tenggat inbox: `answerSlaSec` per proyek dan `deliverTimeoutSec` global.
describe("ADR-0228 · knob brain dicabut, tenggat pindah ke inbox", () => {
  it("baris Setting lama yang masih membawa knob brain tetap ter-parse", () => {
    const old = zLead.parse({ enabled: true, timeoutSec: 600, maxConcurrent: 2, queueWaitSec: 120 });
    expect(old.enabled).toBe(true);
    expect("maxConcurrent" in old).toBe(false);
  });
  it("menunggu jawaban punya ujung", () => {
    expect(LEAD_DEFAULTS.deliverTimeoutSec).toBe(600);
  });
});

describe("SPEC-409 · capability lead (AC-5)", () => {
  it("adds a domain of its own rather than borrowing an existing prefix", () => {
    expect(CAPABILITY_IDS).toContain("lead:read");
    expect(CAPABILITY_IDS).toContain("lead:write");
  });
  it("never lets a read capability stand in for the write one", () => {
    expect(grantsCapability(["lead:read"], "lead:write")).toBe(false);
    expect(grantsCapability(["lead:write"], "lead:read")).toBe(true);
  });
});

describe("SPEC-409 · permintaan putusan (kontrak eksplisit)", () => {
  it("needs a project and a question", () => {
    expect(zLeadAsk.safeParse({ projectId: "p" }).success).toBe(false);
    expect(zLeadAsk.safeParse({ question: "q?" }).success).toBe(false);
    expect(zLeadAsk.safeParse({ projectId: "p", question: "q?" }).success).toBe(true);
  });
});

// SPEC-480 · ADR-0098. Opsi denyut selalu berbentuk "<action> — <penjelasan>"; opsi dialog
// `AskUserQuestion` berupa label bebas. Resolver harus melayani keduanya TANPA pernah menebak:
// SPEC-452 sudah membayar harga pencocokan yang "kelihatan benar" (lead memutuskan Node 22,
// yang terpilih Node 20, dan jejaknya tetap berstatus `berlaku`).
describe("SPEC-480 · resolveChoice", () => {
  const OPTS = [
    "integrate-main — merge branch sesi ini ke main",
    "stop-session — lepas panenya tanpa mengintegrasikan",
    "none — biarkan sesinya berdiri",
  ];

  it("reads a bare 1-based number", () => {
    expect(resolveChoice("2", OPTS)).toEqual({ index: 2, option: OPTS[1] });
    expect(resolveChoice("1.", OPTS)).toEqual({ index: 1, option: OPTS[0] });
    expect(resolveChoice("#3", OPTS)).toEqual({ index: 3, option: OPTS[2] });
    expect(resolveChoice("opsi 2", OPTS)).toEqual({ index: 2, option: OPTS[1] });
    expect(resolveChoice("option 2", OPTS)).toEqual({ index: 2, option: OPTS[1] });
  });

  it("refuses a number outside the list instead of clamping it", () => {
    expect(resolveChoice("0", OPTS)).toBeNull();
    expect(resolveChoice("4", OPTS)).toBeNull();
  });

  it("reads the option text verbatim, ignoring case and stray whitespace", () => {
    expect(resolveChoice("  STOP-SESSION —   lepas panenya tanpa mengintegrasikan ", OPTS))
      .toEqual({ index: 2, option: OPTS[1] });
  });

  it("reads the head of a labelled option", () => {
    expect(resolveChoice("integrate-main", OPTS)).toEqual({ index: 1, option: OPTS[0] });
    expect(resolveChoice("none", OPTS)).toEqual({ index: 3, option: OPTS[2] });
  });

  it("reads a unique prefix", () => {
    expect(resolveChoice("stop-session — lepas", OPTS)).toEqual({ index: 2, option: OPTS[1] });
  });

  it("returns null when a prefix matches more than one option", () => {
    const dua = ["Node 20 LTS", "Node 20 current"];
    expect(resolveChoice("Node 20", dua)).toBeNull();
  });

  it("accepts a number with its label, but only when they agree", () => {
    expect(resolveChoice("2. stop-session", OPTS)).toEqual({ index: 2, option: OPTS[1] });
    expect(resolveChoice("2 integrate-main", OPTS)).toBeNull();   // nomor & label bertentangan
  });

  it("returns null for an invented option, an empty string, or an empty menu", () => {
    expect(resolveChoice("rebase saja", OPTS)).toBeNull();
    expect(resolveChoice("", OPTS)).toBeNull();
    expect(resolveChoice("1", [])).toBeNull();
  });
});

describe("SPEC-480 · clampProse", () => {
  it("leaves prose that already fits untouched apart from folding whitespace", () => {
    expect(clampProse("Pilih opsi 2.", 240)).toBe("Pilih opsi 2.");
    expect(clampProse("dua\n  baris", 240)).toBe("dua baris");
  });

  it("cuts at the last sentence boundary that fits", () => {
    const s = "Satu kalimat pertama. Kalimat kedua yang panjang sekali dan tak akan muat.";
    expect(clampProse(s, 40)).toBe("Satu kalimat pertama.");
  });

  it("cuts at a word boundary with an ellipsis when there is no sentence to cut at", () => {
    const out = clampProse("kalimatpanjangtanpatitik yang terus mengalir tanpa henti", 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("mengalir");
  });

  // Baris baru yang lolos ke pane = Enter = dialog ter-submit separuh jalan (kelas SPEC-452).
  it("never lets a newline survive into the delivered text", () => {
    expect(clampProse("baris satu\nbaris dua", 240)).not.toContain("\n");
  });
});

describe("SPEC-480 · optionActionHint", () => {
  it("reads the action name a caller put at the head of its option label", () => {
    expect(optionActionHint("integrate-main — merge branch sesi ini ke main")).toBe("integrate-main");
    expect(optionActionHint("hold-work: tunda salah satu")).toBe("hold-work");
    expect(optionActionHint("none — biarkan")).toBe("none");
  });
  it("stays null for a plain label and for anything outside the allowlist", () => {
    expect(optionActionHint("Node 22")).toBeNull();
    expect(optionActionHint("deploy — dorong ke produksi")).toBeNull();
    expect(optionActionHint("")).toBeNull();
  });
});

describe("SPEC-480 · leadReplyText", () => {
  const base = { decision: "d", reason: "karena begitu.", reply: "", choices: [], choice: null, missing: [] };

  it("names the chosen option verbatim so the model on the other side cannot mis-read it", () => {
    const out = leadReplyText({ ...base, choice: { index: 2, option: "Node 22" } });
    expect(out).toBe("Pilih: Node 22. karena begitu.");
  });

  it("says what is missing when lead declares the context insufficient", () => {
    const out = leadReplyText({ ...base, missing: ["versi Node yang dipakai produksi", "isi ADR-0086"] });
    expect(out).toContain("Belum bisa kuputuskan");
    expect(out).toContain("versi Node yang dipakai produksi");
    expect(out).toContain("isi ADR-0086");
  });

  it("falls back to reply, then to the decision text", () => {
    expect(leadReplyText({ ...base, reply: "ketik ini" })).toBe("ketik ini");
    expect(leadReplyText(base)).toBe("d");
  });

  it("keeps the delivered text within the shared budget", () => {
    const long = "kata ".repeat(500);
    expect(leadReplyText({ ...base, decision: long }).length)
      .toBeLessThanOrEqual(LEAD_DECISION_MAX + LEAD_REASON_MAX + 1);
  });
});

describe("SPEC-480 · verdict terstruktur", () => {
  it("defaults choice and missing so an older-shaped verdict still parses", () => {
    const v = zLeadVerdict.parse({ decision: "d", reason: "r" });
    expect(v.choice).toBe("");
    expect(v.missing).toEqual([]);
  });
  // Alasan yang sama dengan `action`: pilihan karangan harus BISA MASUK supaya server menolaknya
  // secara sadar dan mencatatnya — bukan lenyap sebagai "keluaran rusak".
  it("lets an invented choice through parsing so the server can refuse it on the record", () => {
    expect(zLeadVerdict.parse({ decision: "d", reason: "r", choice: "opsi kelima" }).choice)
      .toBe("opsi kelima");
  });
  it("caps how many missing items a verdict may carry", () => {
    expect(zLeadVerdict.safeParse({
      decision: "d", reason: "r", missing: Array.from({ length: 11 }, (_, i) => `x${i}`),
    }).success).toBe(false);
  });
});

describe("SPEC-485 · ADR-0102 · pilihan jamak", () => {
  const OPTS = ["alpha — paket alpha", "beta", "gamma"];

  it("resolveChoices memetakan nomor & label, membuang duplikat", () => {
    const r = resolveChoices(["2", "gamma", "beta"], OPTS);
    expect(r.choices.map((c) => c.index)).toEqual([2, 3]);
    expect(r.choices.map((c) => c.option)).toEqual(["beta", "gamma"]);
    expect(r.rejected).toEqual([]);
  });

  it("yang di luar daftar & yang ambigu masuk `rejected`, bukan ditebak", () => {
    const r = resolveChoices(["delta", "9"], OPTS);
    expect(r.choices).toEqual([]);
    expect(r.rejected).toEqual(["delta", "9"]);
  });

  it("urutannya urutan OPSI, bukan urutan lead menyebutnya", () => {
    expect(resolveChoices(["3", "1"], OPTS).choices.map((c) => c.index)).toEqual([1, 3]);
  });

  it("normalizeSelect: single selalu 0..1, apa pun yang diminta", () => {
    expect(normalizeSelect({ mode: "single", min: 0, max: 5 }, 3)).toEqual({ mode: "single", min: 0, max: 1 });
  });

  it("normalizeSelect: multi dijepit ke jumlah opsi", () => {
    expect(normalizeSelect({ mode: "multi", min: 2, max: null }, 3)).toEqual({ mode: "multi", min: 2, max: 3 });
    expect(normalizeSelect({ mode: "multi", min: 0, max: 9 }, 3)).toEqual({ mode: "multi", min: 0, max: 3 });
  });

  it("checkChoiceCount menolak di bawah min & di atas max, dengan alasan terbaca", () => {
    expect(checkChoiceCount(2, { min: 0, max: 1 })).toMatch(/paling banyak 1/);
    expect(checkChoiceCount(0, { min: 1, max: 3 })).toMatch(/paling sedikit 1/);
    expect(checkChoiceCount(2, { min: 1, max: 3 })).toBeNull();
  });

  it("leadReplyText menyebut SEMUA label terpilih, verbatim", () => {
    const line = leadReplyText({
      decision: "d", reason: "karena X.", reply: "",
      choices: [{ index: 1, option: "alpha — paket alpha" }, { index: 3, option: "gamma" }],
      choice: { index: 1, option: "alpha — paket alpha" }, missing: [],
    });
    expect(line).toContain("alpha — paket alpha");
    expect(line).toContain("gamma");
  });

  it("zLeadVerdict menerima `choices`, dan `choice` lama tetap sah", () => {
    expect(zLeadVerdict.parse({ decision: "d", reason: "r", choices: ["1", "2"] }).choices).toEqual(["1", "2"]);
    expect(zLeadVerdict.parse({ decision: "d", reason: "r", choice: "2" }).choices).toEqual([]);
  });

  it("zLeadAsk membawa select/chain/flowId dengan default yang meniru perilaku hari ini", () => {
    const a = zLeadAsk.parse({ projectId: "p", question: "q" });
    expect(a.select).toEqual({ mode: "single", min: 0, max: null });
    expect(a.chain).toBe(false);
    expect(a.flowId).toBeNull();
  });

  it("status rantai punya empat keadaan; dua di antaranya masih menerima langkah", () => {
    expect(zLeadFlowStatus.options).toEqual(["menunggu", "sebagian", "selesai", "dibatalkan"]);
    expect([...LEAD_FLOW_OPEN]).toEqual(["menunggu", "sebagian"]);
  });
});
