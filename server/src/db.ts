import "./env";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveDbUrl, dbFilePath, dbUrlNotice } from "@hanoman/runner";
import { webhookTap, type TapBase } from "./services/webhooks/tap";

// SPEC-398 · ADR-0086 · satu titik yang menormalkan DATABASE_URL sebelum PrismaClient dibuat:
// `file:` absolut, default `~/.hanoman/hanoman.db`. `HANOMAN_DATABASE_URL` non-`file:` melempar;
// `DATABASE_URL` non-`file:` diabaikan dengan peringatan (var itu biasanya milik project lain —
// amandemen ADR-0086). `../prisma` benar di dev (server/src → server/prisma), di bundle repo
// (server/dist → server/prisma), dan di paket npm (dist → <pkg>/prisma).
const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma");
process.umask(0o077);
// Dijaga di sini juga untuk jalur `node dist/server.js` langsung, tanpa lewat CLI.
const notice = dbUrlNotice(process.env);
if (notice) console.warn(notice);
const url = resolveDbUrl(process.env, schemaDir);
process.env.DATABASE_URL = url;
mkdirSync(dirname(dbFilePath(url)), { recursive: true, mode: 0o700 }); // SQLite tak membuat direktori sendiri
// SPEC-481 · ADR-0100 · tap webhook dipasang DI SINI, satu-satunya tempat klien Prisma lahir.
// `base` dipakai tap untuk membaca keadaan sebelum/sesudah TANPA melewati extension lagi
// (rekursi), sekaligus berbagi engine & koneksi yang sama dengan klien yang diekspor.
const base = new PrismaClient();
// SPEC-857 · ADR-0131 §4 · mode jurnal disetel DI SINI karena ia tersimpan di header berkas: sekali
// disetel ia berlaku untuk setiap proses yang membuka DB itu, termasuk `prisma migrate` dan CLI.
// Default SQLite adalah `delete`, dan di mode itu tiap tulisan mengambil kunci eksklusif atas
// SELURUH berkas serta memblokir semua pembaca — itulah yang mengubah change-feed gemuk menjadi
// `P1008 Socket timeout` di hub, bukan ukurannya semata. Tak fatal bila gagal: koneksi lain yang
// sedang menulis menolak peralihan mode sementara, dan boot berikutnya mencobanya lagi.
void base.$queryRawUnsafe("PRAGMA journal_mode=WAL")
  .catch((e) => console.warn("tak bisa menyetel journal_mode=WAL:", e));
export const prisma = base.$extends(webhookTap(base as unknown as TapBase));

// Klien yang diekspor kini ber-extension, jadi ia TAK assignable ke `PrismaClient` polos maupun
// `Prisma.TransactionClient`. Kedua alias ini yang dipakai konsumen — diturunkan dari nilai
// nyatanya supaya menambah/mencabut extension kelak tak menuntut menyunting tanda tangan mana pun.
export type Db = typeof prisma;
export type DbTx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
