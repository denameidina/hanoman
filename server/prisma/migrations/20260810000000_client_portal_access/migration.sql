-- SPEC-617 · ADR-0110 · peran user + pemetaan akun klien → project.
-- Additif & aman untuk DB yang sudah berjalan: user lama mendapat role 'admin' lewat DEFAULT,
-- jadi tak ada akses yang putus. (SQLite hanya melarang DEFAULT CURRENT_TIMESTAMP.)
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ClientProjectAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClientProjectAccess_userId_projectId_key" ON "ClientProjectAccess"("userId", "projectId");
