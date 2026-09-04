// ADR-0160 · pagar untuk layar yang dimuat malas. `React.lazy` melempar saat chunk-nya gagal
// diunduh — kasus nyatanya deploy baru di tengah sesi (SPEC-868): hash chunk berubah, tab lama
// meminta berkas yang sudah tak ada. Tanpa boundary, seluruh App (termasuk sidebar) hilang jadi
// layar putih tanpa tombol apa pun. Di sini: blok galat + "Muat ulang", cermin `ReloadBadge`.
import React from "react";
import { StateBlock } from "./components/state";

type State = { error: Error | null };

export class LazyBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <StateBlock kind="error" title="Halaman gagal dimuat"
        hint="Biasanya karena hanoman baru diperbarui di server. Muat ulang tab ini."
        action={() => window.location.reload()} actionLabel="Muat ulang" />
    );
  }
}
