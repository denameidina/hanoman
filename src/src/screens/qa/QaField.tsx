import React from "react";

// Field QA. Label dihubungkan lewat `htmlFor`, hint lewat `aria-describedby`, dan galat lewat
// `aria-invalid` — tanpa membungkus hint di dalam <label>. `Field` DS membungkus seluruh blok
// (label + kontrol + hint) dalam satu <label>, sehingga nama aksesibel kontrol ikut memuat hint.
// Gayanya meniru `Field` DS (token yang sama). Kontrol DS apa pun yang meneruskan props ke elemen
// native (Input, Select, HnTextarea, input file) menerima `id` dan atribut ARIA dari sini.
type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: true };

export function QaField({ label, hint, invalid = false, children }: {
  label: React.ReactNode; hint?: React.ReactNode; invalid?: boolean; children: React.ReactElement<ControlProps>;
}) {
  const uid = React.useId();
  const id = children.props.id ?? `${uid}-c`;
  const hintId = `${uid}-h`;
  const control = React.cloneElement(children, {
    id,
    "aria-describedby": hint ? hintId : undefined,
    "aria-invalid": invalid ? true : undefined,
  });
  return (
    <div style={{ display: "block", marginBottom: 14, minWidth: 0 }}>
      <label htmlFor={id} style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
        fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>{label}</label>
      {control}
      {hint && <div id={hintId} style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 5 }}>{hint}</div>}
    </div>
  );
}
