-- SPEC-945 · ADR-0150 · fondasi papan tim: direktori orang + kartu kerja manusia.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — dua tabel BARU, tak ada tabel diredefinisi, tanpa backfill.
--
-- `Member.id` deterministik (email ternormalisasi) ditulis aplikasi, bukan default DB: itulah yang
-- mencegah dua mesin melahirkan dua baris untuk orang yang sama (pola CustomAgent, ADR-0094).
-- `Task.specId` sengaja TANPA FOREIGN KEY, cermin Ticket.specId: changefeed bisa memancarkan Task
-- sebelum Spec-nya mendarat (kelas SPEC-382), dan FK akan menolaknya.
CREATE TABLE "Member" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "name"      TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "role"      TEXT,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "version"   INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Member_email_key" ON "Member" ("email");

CREATE TABLE "Task" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "title"     TEXT NOT NULL,
    "detail"    TEXT,
    "status"    TEXT NOT NULL,
    "priority"  TEXT NOT NULL DEFAULT 'sedang',
    "memberId"  TEXT,
    "startDate" DATETIME,
    "dueDate"   DATETIME,
    "order"     REAL NOT NULL DEFAULT 0,
    "specId"    TEXT,
    "version"   INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_memberId_fkey" FOREIGN KEY ("memberId")
        REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Task_projectId_status_idx" ON "Task" ("projectId", "status");
CREATE INDEX "Task_memberId_idx" ON "Task" ("memberId");
