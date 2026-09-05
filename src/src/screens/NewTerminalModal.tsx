import React from "react";
import { coerceClaudeEffort } from "@hanoman/shared";
import { Modal, Button, Select, Field } from "../ds";
import { api } from "../api/client";
import { codexClientTooOld, codexModel, coerceCodexEffort, CODEX_DEFAULTS, type Agent } from "@hanoman/shared";
import { runtimeModels, runtimeEfforts, runtimeFor, type RuntimeDefs } from "./session-runtime";

/**
 * SPEC-517 · form "Sesi baru" di halaman Terminal. Sampai sekarang tombol itu men-spawn agen
 * dengan default global apa adanya — operator yang ingin SATU sesi codex harus menukar Settings
 * untuk SELURUH workspace lalu mengembalikannya. Bentuknya sengaja cermin `StartSessionModal`
 * (ADR-0061): agen menentukan katalog model, model menentukan katalog effort (SPEC-339).
 * Katalognya datang dari `@hanoman/shared` lewat `session-runtime.ts` — tak ada daftar model
 * kedua yang bisa basi.
 */
export function NewTerminalModal({ open, projectId, projectName, onClose, onCreated }: {
  open: boolean; projectId: string; projectName: string;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const [agent, setAgent] = React.useState<Agent>("claude");
  const [model, setModel] = React.useState("claude-opus-5");
  const [effort, setEffort] = React.useState("xhigh");
  const [defs, setDefs] = React.useState<RuntimeDefs>({
    claude: { model: "claude-opus-5", effort: "xhigh" },
    codex: { ...CODEX_DEFAULTS },
  });
  const [busy, setBusy] = React.useState(false);
  // SPEC-339 · versi codex CLI terpasang; null = tak terdeteksi (dan itu tak memicu peringatan).
  const [codexVer, setCodexVer] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    // Gagal-diam (cermin StartSessionModal): form harus tetap bisa dipakai dengan default bawaan
    // walau settings tak terbaca — memblokir "Sesi baru" karena satu GET jauh lebih buruk.
    api.getSettings().then((s) => {
      const d: RuntimeDefs = {
        claude: { model: s.model, effort: s.effort },
        codex: { ...CODEX_DEFAULTS, ...(s.codex ?? {}) },
      };
      const a: Agent = s.agent === "codex" ? "codex" : "claude";
      const r = runtimeFor(d, a);
      setDefs(d); setAgent(a); setModel(r.model); setEffort(r.effort);
    }).catch(() => {});
    api.getCodexVersion().then((v) => setCodexVer(v.version)).catch(() => {});
  }, [open]);

  const pickAgent = (a: Agent) => {
    setAgent(a);
    const r = runtimeFor(defs, a);
    setModel(r.model); setEffort(r.effort);
  };
  // SPEC-339 · menukar model bisa membuat effort terpilih jadi tak sah (Luna tak punya `ultra`).
  const pickModel = (id: string) => {
    setModel(id);
    setEffort((e) => agent === "codex" ? coerceCodexEffort(id, e) : coerceClaudeEffort(id, e));
  };

  async function create() {
    setBusy(true);
    try {
      const { id } = await api.createTerminal(projectId, { agent, model, effort });
      onCreated(id);
      onClose();
    } catch {
      // Gagal (project tak ter-bind) — biarkan modal terbuka; pesan detailnya sudah muncul di
      // jalur pembuatan sesi biasa, form ini tak perlu menduplikasinya.
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} icon="plus" eyebrow={projectName} title="Sesi baru"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon="play" disabled={busy} onClick={() => void create()}>Buka sesi</Button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Runtime untuk sesi ini. Default dari setelan global; ubah bila perlu. Sesi lahir dengan
        pilihan ini untuk seluruh hidupnya — <code>/model</code> di terminal tetap bisa mengubahnya.
      </div>
      <Field label="Agen" hint="Mesin yang menjalankan sesi ini. Perilaku sesi sama; hanya CLI-nya berbeda.">
        <Select aria-label="Agen" value={agent} style={{ width: "100%" }}
          options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickAgent(e.target.value as Agent)} />
      </Field>
      <Field label="Model">
        <Select aria-label="Model" value={model} style={{ width: "100%" }}
          options={runtimeModels(agent).map((m) => ({ value: m.id, label: m.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickModel(e.target.value)} />
      </Field>
      <Field label="Effort">
        <Select aria-label="Effort" value={effort} style={{ width: "100%" }}
          options={runtimeEfforts(agent, model).map((v) => ({ value: v, label: v }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} />
      </Field>
      {/* SPEC-339 · catatan LUNAK: CLI terlalu tua untuk model terpilih. Tak memblokir "Buka sesi" —
          aturannya sama persis dengan kartu Settings & picker Start (satu `codexClientTooOld`). */}
      {agent === "codex" && codexClientTooOld(model, codexVer) && (
        <div data-testid="codex-version-note" style={{
          fontSize: 12, lineHeight: 1.5, marginBottom: 12, padding: "8px 10px",
          borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-muted)",
        }}>
          Codex CLI terpasang <b>{codexVer}</b>, sedangkan <b>{model}</b> butuh <b>{codexModel(model)?.minClient}</b>.
          Sesi tetap boleh dijalankan, tapi modelnya belum tentu dikenali CLI ini.
        </div>
      )}
    </Modal>
  );
}
