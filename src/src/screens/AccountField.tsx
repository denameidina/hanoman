import React from "react";
import type { Agent, AccountLimitsDTO } from "@hanoman/shared";
import { Field, Select } from "../ds";
import { LimitWindows } from "./LimitIndicator";
import { accountOptionLabel, accountsFor } from "./session-runtime";

/**
 * ADR-0234 · pilihan akun runtime untuk satu sesi. Muncul HANYA bila runtime itu punya ≥2 akun —
 * instalasi satu akun tak melihat perubahan apa pun. Akun yang belum login tampil tapi nonaktif.
 * Limit hanya DITANDAI (⚠/‼); pilihan tetap di tangan operator.
 */
export function AccountField({ agent, accounts, value, onChange, className }: {
  agent: Agent; accounts: readonly AccountLimitsDTO[]; value: string; onChange: (id: string) => void; className?: string;
}) {
  const own = accountsFor(accounts, agent);
  if (own.length < 2) return null;
  const selected = own.find((a) => a.accountId === value);
  return (
    <Field label="Akun" hint="Akun langganan yang dipakai sesi ini. Default dari Settings → Akun runtime.">
      <Select aria-label="Akun" value={value} className={className ?? "hn-w-full"}
        options={own.map((a) => ({ value: a.accountId, label: accountOptionLabel(a), disabled: a.loginStatus !== "aktif" }))}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} />
      {selected && selected.limits.windows.length > 0 && <LimitWindows dto={selected.limits} />}
    </Field>
  );
}
