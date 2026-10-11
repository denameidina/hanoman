/* RemoteInstanceView (SPEC-1218 · ADR-0165 §11) — mirroring baca-saja sebuah perangkat lain: gate
   protocol-mismatch SEBELUM apa pun dirender (AC-C7), lalu Tabs Terminal/Dokumen/IDE lewat modul
   yang SAMA dengan layar lokal (TerminalPane/SpecDocsModal/IdeReadPanel) — identitas modul, bukan
   salinan, adalah yang menjamin tampilan byte-identik (AC-C1).

   Audit UI/UX 2026-10: ketiga tab bergantung pada SESI yang terpilih, bukan `sessions[0]`. Tab IDE
   butuh `projectId` dari sesi itu; tab Dokumen butuh `specId`-nya. Tanpa sesi, tab yang bergantung
   padanya menjelaskan alasannya, tidak menampilkan "tak ada" yang menyamar sebagai data. */
import React from "react";
import { Select, StateBlock } from "../ds";
import { Tabs } from "../ds/components/ui";
import { InstanceProvider, type Instance } from "../api/instance";
import { RemoteBanner } from "./RemoteBanner";
import { TerminalPane } from "./TerminalPane";
import { SpecDocsModal } from "./SpecDocsModal";
import { IdeReadPanel } from "./IdeReadPanel";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteInstanceView({ device, hubVersion, sessionId, projectId, onPickSession, onClose }: {
  device: PresenceDeviceView; hubVersion: string;
  /** Sesi yang sedang dilihat. Dikendalikan induk supaya `projectId` selalu berasal dari sesi yang sama. */
  sessionId?: string;
  projectId?: string;
  onPickSession?: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<"terminal" | "docs" | "ide">("terminal");
  if (device.control?.state === "protocol-mismatch") {
    return <StateBlock kind="error" title="Versi protokol tak cocok"
      hint={`${device.name} · protokol ${device.control.protocol}`} />;
  }
  if (!device.control) return <StateBlock kind="empty" title="Kendali jarak jauh tak tersedia" hint={device.name} />;
  const instance: Instance = {
    kind: "remote", deviceId: device.deviceId, name: device.name,
    version: device.control.version, protocol: device.control.protocol, capabilities: device.control.capabilities,
  };
  const session = device.sessions.find((s) => s.sessionId === sessionId);
  return (
    <InstanceProvider value={instance}>
      <RemoteBanner device={device} hubVersion={hubVersion} onClose={onClose} />
      {device.sessions.length > 1 && onPickSession && (
        <Select size="sm" aria-label="Sesi yang dilihat" style={{ width: "100%", marginBottom: 12 }}
          value={session?.sessionId ?? device.sessions[0]?.sessionId ?? ""}
          options={device.sessions.map((s) => ({
            value: s.sessionId, label: `${s.specId ?? s.sessionId} · ${s.projectId}`,
          }))}
          onChange={(e) => onPickSession(e.target.value)} />
      )}
      <Tabs variant="pill" tabs={[{ value: "terminal", label: "Terminal" }, { value: "docs", label: "Dokumen" }, { value: "ide", label: "IDE" }]}
        value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab === "terminal" && (session
        ? <TerminalPane sessionId={session.sessionId} mode="remote" onExit={() => {}} />
        : <StateBlock kind="empty" title="Tak ada sesi berjalan di perangkat ini" hint={device.name} />)}
      {tab === "docs" && (session?.specId
        ? <SpecDocsModal specId={session.specId} onClose={() => setTab("terminal")} />
        : <StateBlock kind="empty" title="Tak ada dokumen untuk sesi ini"
            hint="Dokumen hanya ada untuk sesi yang terkait satu item backlog." />)}
      {tab === "ide" && (projectId
        ? <IdeReadPanel projectId={projectId} />
        : <StateBlock kind="empty" title="Project belum diketahui"
            hint="IDE membuka project dari sesi yang sedang berjalan di perangkat ini." />)}
    </InstanceProvider>
  );
}
