/* RemoteInstanceView (SPEC-1218 · ADR-0165 §11) — mirroring baca-saja sebuah klien lain: gate
   protocol-mismatch SEBELUM apa pun dirender (AC-C7), lalu Tabs Terminal/Dokumen/IDE lewat modul
   yang SAMA dengan layar lokal (TerminalPane/SpecDocsModal/IdeReadPanel) — identitas modul, bukan
   salinan, adalah yang menjamin tampilan byte-identik (AC-C1). */
import React from "react";
import { StateBlock } from "../ds";
import { Tabs } from "../ds/components/ui";
import { InstanceProvider, type Instance } from "../api/instance";
import { RemoteBanner } from "./RemoteBanner";
import { TerminalPane } from "./TerminalPane";
import { SpecDocsModal } from "./SpecDocsModal";
import { IdeReadPanel } from "./IdeReadPanel";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteInstanceView({ device, hubVersion, sessionId, projectId, onClose }: {
  device: PresenceDeviceView; hubVersion: string; sessionId?: string; projectId?: string; onClose: () => void;
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
  return (
    <InstanceProvider value={instance}>
      <RemoteBanner device={device} hubVersion={hubVersion} onClose={onClose} />
      <Tabs variant="pill" tabs={[{ value: "terminal", label: "Terminal" }, { value: "docs", label: "Dokumen" }, { value: "ide", label: "IDE" }]}
        value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab === "terminal" && (sessionId
        ? <TerminalPane sessionId={sessionId} mode="remote" onExit={() => {}} />
        : <StateBlock kind="empty" title="Tak ada sesi terminal aktif" hint={device.name} />)}
      {tab === "docs" && (sessionId
        ? <SpecDocsModal specId={sessionId} onClose={() => setTab("terminal")} />
        : <StateBlock kind="empty" title="Tak ada dokumen untuk sesi ini" hint={device.name} />)}
      {tab === "ide" && (projectId
        ? <IdeReadPanel projectId={projectId} />
        : <StateBlock kind="empty" title="Tak ada project aktif" hint={device.name} />)}
    </InstanceProvider>
  );
}
