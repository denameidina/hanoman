import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";

// ADR-0160 · dua belas layar dimuat malas (`React.lazy`). Di vitest, `import()` pertama sebuah layar
// berat (Terminal + xterm, IDE + highlight) juga berarti TRANSFORM modulnya — terukur 1,6 dtk dingin,
// di atas 1 dtk bawaan `findBy*`/`waitFor`. Batasnya dinaikkan global: test yang lulus tak jadi
// lebih lambat (ia berhenti begitu elemennya muncul), hanya test yang memang gagal menunggu lebih lama.
configure({ asyncUtilTimeout: 5000 });

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
