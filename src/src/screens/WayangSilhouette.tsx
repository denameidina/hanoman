/* WayangSilhouette — siluet wayang kulit kecil untuk layar Dalang (Audit UI/UX 2026-10 · Fase 2E).
   Dulu tinggal di DalangStage.tsx; hero Overview yang memakainya sudah dihapus, komponen ini tetap
   dipakai DalangHanomanScreen sebagai ikon 20–24px. Murni presentasi. */
/* Siluet wayang kulit generik (bukan Anoman — Anoman-nya sang dalang): kepala profil +
   sumping, badan ramping, kain melebar, satu lengan ber-gapit. Digambar sekali, diwarnai
   lewat `fill`/`stroke` dari token pemanggil. */
export function WayangSilhouette({ height, color, rod }: { height: number; color: string; rod: string }) {
  return (
    <svg viewBox="0 0 64 128" width={(height * 64) / 128} height={height} aria-hidden="true" focusable="false">
      {/* gapit utama — tulang pegang dalang */}
      <path d="M31.2 74 L30.2 127 L33.8 127 L32.8 74 Z" fill={rod} />
      {/* gapit lengan */}
      <path d="M51 79 L50.2 122 L53 122 L52.4 79 Z" fill={rod} />
      {/* tubuh: kain, torso, kepala profil menghadap kanan + irah-irahan menyapu ke belakang */}
      <path
        d="M32 73
           C 24 76, 19 88, 17.5 103 C 17 106, 20 107, 24 106.4
           C 28 106, 30 104, 32 104 C 34 104, 36 106, 40 106.4 C 44 107, 47 106, 46.5 103
           C 45 88, 40 76, 32 73 Z"
        fill={color}
      />
      <path d="M32 74 C 29.5 66, 29.5 60, 31 53 L 37 53 C 38.5 60, 37.5 67, 34.5 74 Z" fill={color} />
      <path
        d="M31 53
           C 28.5 48, 29 43.5, 31.5 40.5
           C 28 38.5, 25 34, 25.5 28.5
           C 26 22, 30 16.5, 36 15
           C 34 20, 34.5 24, 37.5 27.5
           C 41 31.5, 44.5 33.5, 46.5 37.5
           C 48 40.5, 47 43.5, 44.5 44.5
           C 46 46.5, 46.5 49, 45 51.5
           C 43 54.5, 38 55, 34.5 53.8 Z"
        fill={color}
      />
      {/* lengan depan: bahu → siku → telapak, menyatu ke gapit lengan */}
      <path
        d="M35 55 C 40 58, 44.5 63, 47.5 69 C 49.5 73, 51 76, 51.8 79.5 L 49.4 80.5
           C 47 76.5, 44.5 72.5, 41.5 68.5 C 38.5 64.5, 35.5 61, 33 58.5 Z"
        fill={color}
      />
    </svg>
  );
}
