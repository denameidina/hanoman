import React from "react";
import { Modal, Button, Select, Field } from "../ds";
import "./styles/terminal.css";

/**
 * SPEC-236 · pilih project dulu sebelum "Terminal biasa": shell mentah lahir di repoDir project
 * terpilih, jadi operator harus tahu di mana ia akan berada. Pola yang sama dengan pemilih
 * project di `NewTerminalModal`; dengan satu project saja layar memanggil `onConfirm` langsung.
 */
export function NewShellModal({ projectId, projects, onProjectChange, onClose, onConfirm }: {
  projectId: string;
  projects: readonly { id: string; name: string }[];
  onProjectChange: (id: string) => void;
  onClose: () => void;
  onConfirm: (projectId: string) => void;
}) {
  return (
    <Modal open onClose={onClose} icon="terminal" title="Terminal biasa"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon="play" disabled={!projectId} onClick={() => onConfirm(projectId)}>Buka terminal</Button>
      </>}>
      <Field label="Project" hint="Shell dibuka di direktori repo project ini.">
        <Select aria-label="Project" value={projectId} className="hn-terminal-field-full"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onProjectChange(e.target.value)} />
      </Field>
    </Modal>
  );
}
