import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({ api: {}, ApiError: class extends Error {} }));
vi.mock("../src/screens/CustomAgentsPanel", () => ({ CustomAgentsPanel: () => null }));
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));

import { ProjectDetailScreen } from "../src/screens/ProjectDetailScreen";

const p = {
  id: "arta", name: "Arta", desc: "", kind: "existing", stack: "", docStatus: "ok", coverage: 90,
  backlog: 2, topStage: "execute", repoDir: "/tmp/arta", gitRemote: "", binding: null,
  helpEnabled: false, session: { status: "idle", phase: null },
} as never;

const noop = () => {};
const base = {
  p, onEdit: noop, onGotoDocs: noop, onGotoTerminal: noop, onGotoBacklog: noop,
  onDelete: noop, onToast: noop,
};

describe("ProjectDetailScreen · pintu Changelog (SPEC-519)", () => {
  it("menawarkan pintu Changelog dan memanggil onGotoChangelog", () => {
    const onGotoChangelog = vi.fn();
    render(<ProjectDetailScreen {...base} onGotoChangelog={onGotoChangelog} />);
    const door = screen.getByText("Changelog");
    fireEvent.click(door);
    expect(onGotoChangelog).toHaveBeenCalled();
  });

  // Generator pindah ke halaman changelog; dua salinan berarti dua tempat yang bisa berbeda perilaku.
  it("tidak lagi merender generator changelog di halaman detail", () => {
    render(<ProjectDetailScreen {...base} onGotoChangelog={noop} />);
    expect(screen.queryByRole("button", { name: /Bangkitkan/ })).toBeNull();
  });
});
