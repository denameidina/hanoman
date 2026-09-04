import "@testing-library/jest-dom";
import { beforeEach } from "vitest";

// SPEC-740 · state tampilan kini persisten di localStorage, dan vitest memakai SATU jsdom
// per berkas test — tanpa ini test pertama yang menyetel filter mewariskannya ke test
// berikutnya di berkas yang sama, dan kegagalannya terbaca seperti regresi komponen.
// Hook setupFiles berjalan sebelum hook tingkat-berkas, jadi berkas yang menyemai
// localStorage di dalam beforeEach/test-nya sendiri tak terpengaruh.
beforeEach(() => {
  try { localStorage.clear(); } catch { /* mode privat */ }
  // ADR-0160 · URL kini state navigasi (router). jsdom yang sama dipakai seluruh berkas, jadi test
  // yang mendarat di /backlog/SPEC-1 mewariskan path itu ke test berikutnya — yang lalu mengira
  // halaman tersimpannya diabaikan.
  try { window.history.replaceState(null, "", "/"); } catch { /* lingkungan tanpa history */ }
});
