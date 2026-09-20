import type { ProjectView, Spec, SpecListItem, SpecSlim } from "@hanoman/shared";

// ProjectVM dulu memperkaya ProjectView dengan tipe trigger per project. Trigger sudah
// tak ada (SPEC-162), dan `ProjectView.session` membawa semua yang layar butuhkan.
export type ProjectVM = ProjectView;
export type { Spec, SpecListItem, SpecSlim };
