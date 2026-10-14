import React from "react";
import { Modal, Button, Select, Field, Callout } from "../ds";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";
import { codexClientTooOld, codexModel, CODEX_DEFAULTS, BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS, type Agent } from "@hanoman/shared";
import { AntigravityVersionNote } from "./settings/fields";
import { runtimeCoerceEffort, runtimeOptions, runtimeModelOptions, runtimeEfforts, runtimeFor, type RuntimeDefs } from "./session-runtime";
import "./styles/terminal.css";

/**
 * SPEC-517 · form "Sesi baru" di halaman Terminal. Sampai sekarang tombol itu men-spawn agen
 * dengan default global apa adanya — operator yang ingin SATU sesi codex harus menukar Settings
 * untuk SELURUH workspace lalu mengembalikannya. Bentuknya sengaja cermin `StartSessionModal`
 * (ADR-0061): agen menentukan katalog model, model menentukan katalog effort (SPEC-339).
 * Katalognya datang dari `@hanoman/shared` lewat `session-runtime.ts` — tak ada daftar model
 * kedua yang bisa basi.
 */
export function NewTerminalModal({ open, projectId, projectName, projects, onProjectChange, onClose, onCreated }: {
  open: boolean; projectId: string; projectName: string;
  // Audit UI/UX 2026-10 · Fase 3E: project dipilih di sini (toolbar tak lagi memuat pemilih). Opsional:
  // tanpa `onProjectChange` atau dengan satu project, pilihan project tak ditampilkan.
  projects?: readonly { id: string; name: string }[]; onProjectChange?: (id: string) => void;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const [agent, setAgent] = React.useState<Agent>("claude");
  const [model, setModel] = React.useState("sonnet");
  const [effort, setEffort] = React.useState("medium");
  const [defs, setDefs] = React.useState<RuntimeDefs>({
    claude: { model: "sonnet", effort: "medium" },
    codex: { ...CODEX_DEFAULTS },
    antigravity: { ...BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS },
  });
  const [busy, setBusy] = React.useState(false);
  // Audit UI/UX Terminal · galat tak lagi ditelan: dua hal berbeda tampil terpisah. Gagal memuat
  // setelan hanya mengurangi pilihan (form tetap jalan dengan default bawaan); gagal membuka sesi
  // membuat operator tahu bahwa sesi TIDAK ada, dan modal tetap terbuka untuk dicoba lagi.
  const [settingsNotice, setSettingsNotice] = React.useState<string | null>(null);
  const [createError, setCreateError] = React.useState<string | null>(null);
  // SPEC-339 · versi codex CLI terpasang; null = tak terdeteksi (dan itu tak memicu peringatan).
  const [codexVer, setCodexVer] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSettingsNotice(null);
    setCreateError(null);
    // Form harus tetap bisa dipakai dengan default bawaan walau settings tak terbaca — memblokir
    // "Sesi baru" karena satu GET jauh lebih buruk. Kegagalannya tetap dikatakan, bukan diam.
    api.getSettings().then((s) => {
      const d: RuntimeDefs = {
        claude: { model: s.model, effort: s.effort },
        codex: { ...CODEX_DEFAULTS, ...(s.codex ?? {}) },
        antigravity: { ...BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS, ...(s.antigravity ?? {}) },
      };
      const a: Agent = s.agent ?? "claude";
      const r = runtimeFor(d, a);
      setDefs(d); setAgent(a); setModel(r.model); setEffort(r.effort);
    }).catch((e: unknown) => {
      setSettingsNotice(`${failureMessage("memuat pengaturan", e)} · memakai default bawaan`);
    });
    // Versi Codex hanya dasar peringatan kompatibilitas model; galatnya tetap ditulis di notice, bukan diam.
    api.getCodexVersion().then((v) => setCodexVer(v.version)).catch((e: unknown) => {
      setSettingsNotice((n) => (n ? `${n} · ` : "") + failureMessage("membaca versi Codex CLI", e));
    });
  }, [open]);

  const pickAgent = (a: Agent) => {
    setAgent(a);
    const r = runtimeFor(defs, a);
    setModel(r.model); setEffort(r.effort);
  };
  // SPEC-339 · menukar model bisa membuat effort terpilih jadi tak sah (Luna tak punya `ultra`).
  const pickModel = (id: string) => {
    setModel(id);
    setEffort((e) => runtimeCoerceEffort(agent, id, e));
  };

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      const { id } = await api.createTerminal(projectId, { agent, model, effort });
      onCreated(id);
      onClose();
    } catch (e) {
      // Modal tetap terbuka supaya pilihan runtime tak hilang; alasannya tampil di sini.
      setCreateError(failureMessage("membuka sesi", e));
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} icon="plus" eyebrow={projectName} title="Sesi baru"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon="play" disabled={busy} onClick={() => void create()}>Buka sesi</Button>
      </>}>
      {settingsNotice && (
        <Callout tone="warn" title="Pengaturan belum terbaca" className="hn-terminal-notice">{settingsNotice}</Callout>
      )}
      {createError && (
        <Callout tone="err" title="Sesi belum terbuka" className="hn-terminal-notice">{createError}</Callout>
      )}
      <div className="hn-terminal-intro">
        Runtime untuk sesi ini. Default dari setelan global; ubah bila perlu. Sesi lahir dengan
        pilihan ini untuk seluruh hidupnya — <code>/model</code> di terminal tetap bisa mengubahnya.
      </div>
      {projects && onProjectChange && projects.length > 1 && (
        <Field label="Project" hint="Direktori repo tempat sesi dibuka.">
          <Select aria-label="Project" value={projectId} className="hn-terminal-field-full"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onProjectChange(e.target.value)} />
        </Field>
      )}
      <Field label="Agen" hint="Mesin yang menjalankan sesi ini. Perilaku sesi sama; hanya CLI-nya berbeda.">
        <Select aria-label="Agen" value={agent} className="hn-terminal-field-full"
          options={runtimeOptions}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickAgent(e.target.value as Agent)} />
      </Field>
      <Field label="Model">
        <Select aria-label="Model" value={model} className="hn-terminal-field-full"
          options={runtimeModelOptions(agent, model)}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickModel(e.target.value)} />
      </Field>
      <Field label="Effort">
        <Select aria-label="Effort" value={effort} className="hn-terminal-field-full"
          options={runtimeEfforts(agent, model).map((v) => ({ value: v, label: v }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} />
      </Field>
      {/* SPEC-339 · catatan LUNAK: CLI terlalu tua untuk model terpilih. Tak memblokir "Buka sesi" —
          aturannya sama persis dengan kartu Settings & picker Start (satu `codexClientTooOld`). */}
      {agent === "antigravity" && <AntigravityVersionNote />}
      {agent === "codex" && codexClientTooOld(model, codexVer) && (
        <div data-testid="codex-version-note" className="hn-terminal-codex-note">
          Codex CLI terpasang <b>{codexVer}</b>, sedangkan <b>{model}</b> butuh <b>{codexModel(model)?.minClient}</b>.
          Sesi tetap boleh dijalankan, tapi modelnya belum tentu dikenali CLI ini.
        </div>
      )}
    </Modal>
  );
}
