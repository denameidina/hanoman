import type { AgentEvalCase } from "../../runner/src/custom-agent-eval";

const finding = (id: string, ...patterns: string[]) => ({ id, patterns });

export const AGENT_EVAL_CASES: readonly AgentEvalCase[] = [
  {
    id: "scout-positive", agentName: "scout",
    task: "Petakan semua cermin payload pengguna dan tunjukkan yang tertinggal setelah diff.",
    expected: [finding(
      "renamed-mirror", "packages/web/source\\.txt", "AccountWire", "locale", "stale|tertinggal",
    )],
    forbidden: [finding(
      "false-no-mirror", "(?:tidak ada|tidak ditemukan) cermin(?: payload)?(?: pengguna)?(?:[.!]|$)",
    )],
    fixtureDir: "fixtures/scout-positive", source: "SPEC-950 audit: duplicate payload with a different symbol name",
  },
  {
    id: "scout-control", agentName: "scout",
    task: "Petakan semua cermin payload pengguna dan pastikan diff tetap konsisten.",
    expected: [finding(
      "mirror-synchronized", "AccountWire", "locale", "sinkron|konsisten|konsistensi|simetris|identik",
    )],
    forbidden: [finding("false-stale", "AccountWire", "tertinggal")],
    fixtureDir: "fixtures/scout-control", source: "SPEC-950 negative control",
  },
  {
    id: "blast-radius-positive", agentName: "blast-radius",
    task: "Audit blast radius perubahan kontrak Profile terhadap daftar field manual.",
    expected: [finding("manual-list-stale", "PROFILE_FIELDS", "locale", "hilang|tertinggal")],
    forbidden: [finding("false-complete", "semua", "lengkap")],
    fixtureDir: "fixtures/blast-radius-positive", source: "SPEC-950 audit: manual field list drift",
  },
  {
    id: "blast-radius-control", agentName: "blast-radius",
    task: "Audit blast radius perubahan kontrak Profile terhadap daftar field manual.",
    expected: [finding("manual-list-updated", "PROFILE_FIELDS", "locale", "sinkron|lengkap")],
    forbidden: [finding("false-drift", "PROFILE_FIELDS", "tertinggal")],
    fixtureDir: "fixtures/blast-radius-control", source: "SPEC-950 negative control",
  },
  {
    id: "security-reviewer-positive", agentName: "security-reviewer",
    task: "Telusuri autentikasi dan otorisasi endpoint dokumen yang baru.",
    expected: [finding("missing-ownership", "GET /documents/:id", "authenticated", "ownership", "missing|hilang")],
    forbidden: [finding("false-safe", "ownership", "enforced|aman")],
    fixtureDir: "fixtures/security-reviewer-positive", source: "SPEC-950 audit: authenticated IDOR",
  },
  {
    id: "security-reviewer-control", agentName: "security-reviewer",
    task: "Telusuri autentikasi dan otorisasi endpoint dokumen yang baru.",
    expected: [finding("ownership-enforced", "GET /documents/:id", "ownerId", "enforced|aman")],
    forbidden: [finding("false-idor", "ownership", "missing|hilang")],
    fixtureDir: "fixtures/security-reviewer-control", source: "SPEC-950 negative control",
  },
  {
    id: "qa-verifier-positive", agentName: "qa-verifier",
    task: "Buktikan test baru merah pada base sebelum menyatakan perubahan terverifikasi.",
    expected: [finding("irrelevant-test", "base", "tetap (hijau|lulus)", "tak membuktikan|tidak relevan")],
    forbidden: [finding("false-relevant", "test", "relevan", "merah pada base")],
    fixtureDir: "fixtures/qa-verifier-positive", source: "SPEC-950 audit: test passes without implementation",
  },
  {
    id: "qa-verifier-control", agentName: "qa-verifier",
    task: "Buktikan test baru merah pada base sebelum menyatakan perubahan terverifikasi.",
    expected: [finding("relevant-test", "merah pada base", "relevan", "normalizeEmail")],
    forbidden: [finding("false-irrelevant", "tetap hijau", "base")],
    fixtureDir: "fixtures/qa-verifier-control", source: "SPEC-950 negative control",
  },
  {
    id: "root-causer-positive", agentName: "root-causer",
    task: "Diagnosis TTL nol: bedakan hipotesis config hilang dengan operator fallback yang salah.",
    expected: [finding("distinguishing-experiment", "config hilang", "TTL=0", "eksperimen", "\\|\\|", "akar")],
    forbidden: [finding("premature-fix", "kemungkinan besar", "langsung ganti")],
    fixtureDir: "fixtures/root-causer-positive", source: "SPEC-950 audit: competing hypotheses",
  },
  {
    id: "root-causer-control", agentName: "root-causer",
    task: "Reproduksi laporan TTL nol dan putuskan apakah ada akar masalah.",
    expected: [finding("no-reproduction", "TTL=0", "dipertahankan", "tidak ada bug|tidak tereproduksi")],
    forbidden: [finding("invented-root", "config hilang", "akar")],
    fixtureDir: "fixtures/root-causer-control", source: "SPEC-950 negative control",
  },
  {
    id: "edge-case-hunter-positive", agentName: "edge-case-hunter",
    task: "Cari batas kontrak webhook yang belum diuji, khususnya delivery berulang.",
    expected: [finding("missing-idempotency", "duplicate delivery|delivery ganda", "idempotensi", "belum diuji|test.*tidak ada")],
    forbidden: [finding("false-covered", "duplicate delivery", "sudah tertutup")],
    fixtureDir: "fixtures/edge-case-hunter-positive", source: "SPEC-950 audit: duplicate delivery untested",
  },
  {
    id: "edge-case-hunter-control", agentName: "edge-case-hunter",
    task: "Cari batas kontrak webhook yang belum diuji, khususnya delivery berulang.",
    expected: [finding("idempotency-covered", "duplicate delivery|delivery ganda", "idempotensi", "sudah tertutup")],
    forbidden: [finding("false-missing", "duplicate delivery", "belum diuji")],
    fixtureDir: "fixtures/edge-case-hunter-control", source: "SPEC-950 negative control",
  },
  {
    id: "spec-auditor-positive", agentName: "spec-auditor",
    task: "Cocokkan acceptance criterion audit log dengan jejak implementasi di diff.",
    expected: [finding("checkbox-without-evidence", "audit log", "tercentang", "tanpa jejak|tidak ada.*diff", "tak terpenuhi")],
    forbidden: [finding("checkbox-as-proof", "kotak", "bukti terpenuhi")],
    fixtureDir: "fixtures/spec-auditor-positive", source: "SPEC-950 audit: checked criterion without diff evidence",
  },
  {
    id: "spec-auditor-control", agentName: "spec-auditor",
    task: "Cocokkan acceptance criterion audit log dengan jejak implementasi di diff.",
    expected: [finding("criterion-evidenced", "audit log", "emitAudit", "terpenuhi", "source\\.txt")],
    forbidden: [finding("false-missing", "audit log", "tak terpenuhi")],
    fixtureDir: "fixtures/spec-auditor-control", source: "SPEC-950 negative control",
  },
  {
    id: "dep-auditor-positive", agentName: "dep-auditor",
    task: "Audit dependensi nanoid yang baru dan cek kemampuan runtime yang sudah ada.",
    expected: [finding("runtime-duplicate", "nanoid", "crypto\\.randomUUID", "duplikat|tidak perlu", "tolak")],
    forbidden: [finding("false-accept", "nanoid", "aman tanpa catatan")],
    fixtureDir: "fixtures/dep-auditor-positive", source: "SPEC-950 audit: dependency duplicates runtime",
  },
  {
    id: "dep-auditor-control", agentName: "dep-auditor",
    task: "Audit pembuatan ID setelah diff dan pastikan tidak ada dependensi baru.",
    expected: [finding("runtime-only", "crypto\\.randomUUID", "tanpa dependensi baru", "aman")],
    forbidden: [finding("invented-dependency", "nanoid", "ditambah")],
    fixtureDir: "fixtures/dep-auditor-control", source: "SPEC-950 negative control",
  },
];
