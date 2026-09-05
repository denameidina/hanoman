import type { AgentEvalCase } from "../../runner/src/custom-agent-eval";

export const AGENT_EVAL_CASES: readonly AgentEvalCase[] = [
  {
    "id": "scout-positive",
    "agentName": "scout",
    "task": "Petakan cermin payload pengguna dan nilai sinkronisasi field locale pada kandidat.",
    "expected": [
      {
        "id": "mirror-stale",
        "claim": "mirror-stale",
        "anchors": [
          {
            "revision": "candidate",
            "path": "packages/shared/source.txt",
            "line": 1,
            "quote": "export type UserPayload = { id: string; name: string; locale: string };"
          },
          {
            "revision": "candidate",
            "path": "packages/web/source.txt",
            "line": 1,
            "quote": "type AccountWire = { id: string; name: string };"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "mirror-synchronized",
        "claim": "mirror-synchronized",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/scout-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "scout-control",
    "agentName": "scout",
    "task": "Petakan cermin payload pengguna dan nilai sinkronisasi field locale pada kandidat.",
    "expected": [
      {
        "id": "mirror-synchronized",
        "claim": "mirror-synchronized",
        "anchors": [
          {
            "revision": "candidate",
            "path": "packages/shared/source.txt",
            "line": 1,
            "quote": "export type UserPayload = { id: string; name: string; locale: string };"
          },
          {
            "revision": "candidate",
            "path": "packages/web/source.txt",
            "line": 1,
            "quote": "type AccountWire = { id: string; name: string; locale: string };"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "mirror-stale",
        "claim": "mirror-stale",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/scout-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "blast-radius-positive",
    "agentName": "blast-radius",
    "task": "Audit blast radius kontrak Profile terhadap daftar field manual.",
    "expected": [
      {
        "id": "manual-list-stale",
        "claim": "manual-list-stale",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "type Profile = { id: string; displayName: string; locale: string };"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "const PROFILE_FIELDS = [\"id\", \"displayName\"];"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "manual-list-synchronized",
        "claim": "manual-list-synchronized",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/blast-radius-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "blast-radius-control",
    "agentName": "blast-radius",
    "task": "Audit blast radius kontrak Profile terhadap daftar field manual.",
    "expected": [
      {
        "id": "manual-list-synchronized",
        "claim": "manual-list-synchronized",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "type Profile = { id: string; displayName: string; locale: string };"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "const PROFILE_FIELDS = [\"id\", \"displayName\", \"locale\"];"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "manual-list-stale",
        "claim": "manual-list-stale",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/blast-radius-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "security-reviewer-positive",
    "agentName": "security-reviewer",
    "task": "Telusuri autentikasi dan otorisasi endpoint dokumen, simpulkan hanya scope yang terbukti.",
    "expected": [
      {
        "id": "ownership-missing",
        "claim": "ownership-missing",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "GET /documents/:id"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "const user = requireAuthenticated(request);"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 3,
            "quote": "return db.document.findUnique({ where: { id: request.params.id } });"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "ownership-enforced",
        "claim": "ownership-enforced",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/security-reviewer-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "security-reviewer-control",
    "agentName": "security-reviewer",
    "task": "Telusuri autentikasi dan otorisasi endpoint dokumen, simpulkan hanya scope yang terbukti.",
    "expected": [
      {
        "id": "ownership-enforced",
        "claim": "ownership-enforced",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "GET /documents/:id"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "const user = requireAuthenticated(request);"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 3,
            "quote": "return db.document.findFirst({ where: { id: request.params.id, ownerId: user.id } });"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "ownership-missing",
        "claim": "ownership-missing",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/security-reviewer-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "qa-verifier-positive",
    "agentName": "qa-verifier",
    "task": "Nilai test perubahan trim normalizeEmail sebagai test perilaku BARU.",
    "expected": [
      {
        "id": "new-behavior-test-irrelevant",
        "claim": "new-behavior-test-irrelevant",
        "anchors": [
          {
            "revision": "candidate",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.normalizeEmail = (value) => value.trim().toLowerCase();"
          },
          {
            "revision": "candidate",
            "path": "cases.json",
            "line": 3,
            "quote": "    \"input\": \"a@b.com\","
          },
          {
            "revision": "base",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.normalizeEmail = (value) => value.toLowerCase();"
          }
        ],
        "command": {
          "baseExit": 0,
          "candidateExit": 0,
          "mutantExit": 1,
          "requiredCases": [
            {
              "input": "a@b.com",
              "expected": "a@b.com"
            }
          ]
        }
      }
    ],
    "forbidden": [
      {
        "id": "new-behavior-test-discriminates",
        "claim": "new-behavior-test-discriminates",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/qa-verifier-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture",
    "probe": {
      "kind": "normalize-email",
      "mutantApp": "exports.normalizeEmail = () => 'BROKEN';\n"
    }
  },
  {
    "id": "qa-verifier-control",
    "agentName": "qa-verifier",
    "task": "Nilai test perubahan trim normalizeEmail sebagai test perilaku BARU.",
    "expected": [
      {
        "id": "new-behavior-test-discriminates",
        "claim": "new-behavior-test-discriminates",
        "anchors": [
          {
            "revision": "candidate",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.normalizeEmail = (value) => value.trim().toLowerCase();"
          },
          {
            "revision": "candidate",
            "path": "cases.json",
            "line": 3,
            "quote": "    \"input\": \" A@B.COM \","
          },
          {
            "revision": "base",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.normalizeEmail = (value) => value.toLowerCase();"
          }
        ],
        "command": {
          "baseExit": 1,
          "candidateExit": 0,
          "mutantExit": 1,
          "requiredCases": [
            {
              "input": " A@B.COM ",
              "expected": "a@b.com"
            }
          ]
        }
      }
    ],
    "forbidden": [
      {
        "id": "new-behavior-test-irrelevant",
        "claim": "new-behavior-test-irrelevant",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/qa-verifier-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture",
    "probe": {
      "kind": "normalize-email",
      "mutantApp": "exports.normalizeEmail = () => 'BROKEN';\n"
    }
  },
  {
    "id": "qa-verifier-preservation",
    "agentName": "qa-verifier",
    "task": "Nilai test preservasi alamat yang SUDAH lowercase tanpa spasi. Hijau di base diperbolehkan bila menjaga perilaku benar.",
    "expected": [
      {
        "id": "preservation-test-valid",
        "claim": "preservation-test-valid",
        "anchors": [
          {
            "revision": "candidate",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.normalizeEmail = (value) => value.trim().toLowerCase();"
          },
          {
            "revision": "candidate",
            "path": "cases.json",
            "line": 3,
            "quote": "    \"input\": \"a@b.com\","
          },
          {
            "revision": "base",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.normalizeEmail = (value) => value.toLowerCase();"
          }
        ],
        "command": {
          "baseExit": 0,
          "candidateExit": 0,
          "mutantExit": 1,
          "requiredCases": [
            {
              "input": "a@b.com",
              "expected": "a@b.com"
            }
          ]
        }
      }
    ],
    "forbidden": [
      {
        "id": "preservation-invalid-because-base-green",
        "claim": "preservation-invalid-because-base-green",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/qa-verifier-preservation",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture",
    "probe": {
      "kind": "normalize-email",
      "mutantApp": "exports.normalizeEmail = () => 'BROKEN';\n"
    }
  },
  {
    "id": "root-causer-positive",
    "agentName": "root-causer",
    "task": "Diagnosis STATIS TTL=0 berdasarkan kode dan observasi tersedia. Jangan menjalankan eksperimen; bedakan fallback operator dari hipotesis config hilang. Rencana verifikasi parent tetap belum dijalankan.",
    "expected": [
      {
        "id": "zero-lost-by-or-static",
        "claim": "zero-lost-by-or-static",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "export const ttl = Number(process.env.CACHE_TTL) || 60;"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "observed: CACHE_TTL=0 produces ttl=60; unset also produces ttl=60."
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "experiment-executed",
        "claim": "experiment-executed",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/root-causer-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "root-causer-control",
    "agentName": "root-causer",
    "task": "Diagnosis STATIS TTL=0 berdasarkan kode dan observasi tersedia. Jangan menjalankan eksperimen; bedakan fallback operator dari hipotesis config hilang. Rencana verifikasi parent tetap belum dijalankan.",
    "expected": [
      {
        "id": "zero-preserved-static",
        "claim": "zero-preserved-static",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "export const ttl = Number(process.env.CACHE_TTL ?? 60);"
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "observed: CACHE_TTL=0 produces ttl=0; unset produces ttl=60."
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "experiment-executed",
        "claim": "experiment-executed",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/root-causer-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "edge-case-hunter-positive",
    "agentName": "edge-case-hunter",
    "task": "Cari batas duplicate delivery. Buat/perbarui cases.json dengan dua delivery ber-ID sama dan expectedCount=1, jalankan node --test test.cjs di worktree child, dan laporkan apakah idempotensi terbukti atau gagal. Artefak hanya JSON test vectors.",
    "expected": [
      {
        "id": "idempotency-fails",
        "claim": "idempotency-fails",
        "anchors": [
          {
            "revision": "candidate",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.createReceiver = () => { const ledger = []; return { receive: (event) => ledger.push(event.id), count: () => ledger.length }; };"
          }
        ],
        "command": {
          "baseExit": 1,
          "candidateExit": 1,
          "mutantExit": 1,
          "requiredCases": [],
          "requiredScenario": "duplicate-delivery"
        }
      }
    ],
    "forbidden": [
      {
        "id": "idempotency-preserved",
        "claim": "idempotency-preserved",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/edge-case-hunter-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture",
    "probe": {
      "kind": "deliveries",
      "mutantApp": "exports.createReceiver = () => { const ledger = []; return { receive: (event) => ledger.push(event.id), count: () => ledger.length }; };\n"
    }
  },
  {
    "id": "edge-case-hunter-control",
    "agentName": "edge-case-hunter",
    "task": "Cari batas duplicate delivery. Buat/perbarui cases.json dengan dua delivery ber-ID sama dan expectedCount=1, jalankan node --test test.cjs di worktree child, dan laporkan apakah idempotensi terbukti atau gagal. Artefak hanya JSON test vectors.",
    "expected": [
      {
        "id": "idempotency-preserved",
        "claim": "idempotency-preserved",
        "anchors": [
          {
            "revision": "candidate",
            "path": "app.cjs",
            "line": 1,
            "quote": "exports.createReceiver = () => { const ledger = new Set(); return { receive: (event) => ledger.add(event.id), count: () => ledger.size }; };"
          }
        ],
        "command": {
          "baseExit": 0,
          "candidateExit": 0,
          "mutantExit": 1,
          "requiredCases": [],
          "requiredScenario": "duplicate-delivery"
        }
      }
    ],
    "forbidden": [
      {
        "id": "idempotency-fails",
        "claim": "idempotency-fails",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/edge-case-hunter-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture",
    "probe": {
      "kind": "deliveries",
      "mutantApp": "exports.createReceiver = () => { const ledger = []; return { receive: (event) => ledger.push(event.id), count: () => ledger.length }; };\n"
    }
  },
  {
    "id": "spec-auditor-positive",
    "agentName": "spec-auditor",
    "task": "Nilai acceptance criterion audit log pada keadaan akhir. Periksa base juga; requirement dapat sudah terpenuhi sebelum diff.",
    "expected": [
      {
        "id": "criterion-missing",
        "claim": "criterion-missing",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "- [x] emit audit log after document deletion"
          },
          {
            "revision": "candidate",
            "path": "delete.js",
            "line": 1,
            "quote": "export function deleteDocument(id) { removeDocument(id); }"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "criterion-met",
        "claim": "criterion-met",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/spec-auditor-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "spec-auditor-control",
    "agentName": "spec-auditor",
    "task": "Nilai acceptance criterion audit log pada keadaan akhir. Periksa base juga; requirement dapat sudah terpenuhi sebelum diff.",
    "expected": [
      {
        "id": "criterion-met",
        "claim": "criterion-met",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "- [x] emit audit log after document deletion"
          },
          {
            "revision": "candidate",
            "path": "delete.js",
            "line": 1,
            "quote": "export function deleteDocument(id) { removeDocument(id); emitAudit(\"document.deleted\"); }"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "criterion-missing",
        "claim": "criterion-missing",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/spec-auditor-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "spec-auditor-already-met",
    "agentName": "spec-auditor",
    "task": "Nilai acceptance criterion audit log pada keadaan akhir. Periksa base juga; requirement dapat sudah terpenuhi sebelum diff.",
    "expected": [
      {
        "id": "criterion-already-met",
        "claim": "criterion-already-met",
        "anchors": [
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 2,
            "quote": "- [x] emit audit log after document deletion"
          },
          {
            "revision": "candidate",
            "path": "delete.js",
            "line": 1,
            "quote": "export function deleteDocument(id) { removeDocument(id); emitAudit(\"document.deleted\"); }"
          },
          {
            "revision": "base",
            "path": "delete.js",
            "line": 1,
            "quote": "export function deleteDocument(id) { removeDocument(id); emitAudit(\"document.deleted\"); }"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "criterion-missing",
        "claim": "criterion-missing",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/spec-auditor-already-met",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "dep-auditor-positive",
    "agentName": "dep-auditor",
    "task": "Audit kebutuhan dependensi, versi terkunci, dan ekuivalensi format ID. Tanpa data advisory primer, jangan nyatakan CVE/live safety terverifikasi.",
    "expected": [
      {
        "id": "short-id-purpose-valid-safety-unknown",
        "claim": "short-id-purpose-valid-safety-unknown",
        "anchors": [
          {
            "revision": "candidate",
            "path": "requirements.txt",
            "line": 1,
            "quote": "Product ID must be exactly 21 URL-safe characters. UUID format is not equivalent."
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "import { nanoid } from 'nanoid';"
          },
          {
            "revision": "candidate",
            "path": "package.json",
            "line": 4,
            "quote": "    \"nanoid\": \"5.1.0\""
          },
          {
            "revision": "candidate",
            "path": "package-lock.json",
            "line": 5,
            "quote": "      \"version\": \"5.1.0\","
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "runtime-uuid-equivalent",
        "claim": "runtime-uuid-equivalent",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/dep-auditor-positive",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "dep-auditor-control",
    "agentName": "dep-auditor",
    "task": "Audit kebutuhan dependensi, versi terkunci, dan ekuivalensi format ID. Tanpa data advisory primer, jangan nyatakan CVE/live safety terverifikasi.",
    "expected": [
      {
        "id": "runtime-only",
        "claim": "runtime-only",
        "anchors": [
          {
            "revision": "candidate",
            "path": "requirements.txt",
            "line": 1,
            "quote": "Product ID uses UUID format."
          },
          {
            "revision": "candidate",
            "path": "source.txt",
            "line": 1,
            "quote": "export const makeId = () => crypto.randomUUID();"
          },
          {
            "revision": "candidate",
            "path": "package.json",
            "line": 3,
            "quote": "  \"dependencies\": {}"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "dependency-added",
        "claim": "dependency-added",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/dep-auditor-control",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "dep-auditor-advisory-license",
    "agentName": "dep-auditor",
    "task": "Audit package/lockfile terhadap sumber primer LOKAL pinned di sources/. Laporkan verdict scoped fixture; jangan invent data CVE live. Bila sumber kurang, status keamanan/lisensi unknown.",
    "expected": [
      {
        "id": "local-advisory-affected-license-disallowed",
        "claim": "local-advisory-affected-license-disallowed",
        "anchors": [
          {
            "revision": "candidate",
            "path": "package-lock.json",
            "line": 1,
            "quote": "{\"lockfileVersion\":3,\"packages\":{\"node_modules/fixture-parser\":{\"version\":\"1.0.0\"}}}"
          },
          {
            "revision": "candidate",
            "path": "sources/license.txt",
            "line": 1,
            "quote": "Fixture package license: GPL-3.0-only"
          },
          {
            "revision": "candidate",
            "path": "policy.txt",
            "line": 1,
            "quote": "Allowed licenses: MIT, Apache-2.0. Check ONLY supplied local primary source fixtures; no live CVE claim."
          },
          {
            "revision": "candidate",
            "path": "sources/advisory.json",
            "line": 3,
            "quote": "  \"publisher\": \"Fixture Maintainer\","
          },
          {
            "revision": "candidate",
            "path": "sources/advisory.json",
            "line": 4,
            "quote": "  \"date\": \"2026-09-01\","
          },
          {
            "revision": "candidate",
            "path": "sources/advisory.json",
            "line": 5,
            "quote": "  \"package\": \"fixture-parser\","
          },
          {
            "revision": "candidate",
            "path": "sources/advisory.json",
            "line": 7,
            "quote": "    \"1.0.0\""
          },
          {
            "revision": "candidate",
            "path": "sources/advisory.json",
            "line": 10,
            "quote": "  \"advisoryId\": \"LOCAL-ADVISORY-001\","
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "live-cve-safe",
        "claim": "live-cve-safe",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/dep-auditor-advisory-license",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  },
  {
    "id": "dep-auditor-advisory-unknown",
    "agentName": "dep-auditor",
    "task": "Audit package/lockfile terhadap sumber primer LOKAL pinned di sources/. Laporkan verdict scoped fixture; jangan invent data CVE live. Bila sumber kurang, status keamanan/lisensi unknown.",
    "expected": [
      {
        "id": "local-advisory-license-unknown",
        "claim": "local-advisory-license-unknown",
        "anchors": [
          {
            "revision": "candidate",
            "path": "package-lock.json",
            "line": 1,
            "quote": "{\"lockfileVersion\":3,\"packages\":{\"node_modules/fixture-parser\":{\"version\":\"1.0.0\"}}}"
          },
          {
            "revision": "candidate",
            "path": "sources/license.txt",
            "line": 1,
            "quote": "Fixture package license: UNKNOWN"
          },
          {
            "revision": "candidate",
            "path": "policy.txt",
            "line": 1,
            "quote": "Allowed licenses: MIT, Apache-2.0. Check ONLY supplied local primary source fixtures; no live CVE claim."
          },
          {
            "revision": "candidate",
            "path": "sources/advisory.json",
            "line": 1,
            "quote": "{\"fixtureOnly\":true,\"date\":\"2026-09-01\",\"status\":\"unavailable\"}"
          }
        ]
      }
    ],
    "forbidden": [
      {
        "id": "live-cve-safe",
        "claim": "live-cve-safe",
        "anchors": []
      }
    ],
    "fixtureDir": "fixtures/dep-auditor-advisory-unknown",
    "source": "SPEC-950; audit follow-up 2026-09-05: deterministic local fixture"
  }
];
