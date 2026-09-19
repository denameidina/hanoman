import type { RemoteCapability } from "@hanoman/shared";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IdeReadPanel } from "../src/screens/IdeReadPanel";
import { InstanceProvider } from "../src/api/instance";

const ideTree = vi.fn();
const ideWorkingStatus = vi.fn();
const ideFile = vi.fn();
const ideFileDiff = vi.fn();
const ideGraph = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {},
  createApi: () => ({
    ideTree: (...a: unknown[]) => ideTree(...a),
    ideWorkingStatus: (...a: unknown[]) => ideWorkingStatus(...a),
    ideFile: (...a: unknown[]) => ideFile(...a),
    ideFileDiff: (...a: unknown[]) => ideFileDiff(...a),
    ideGraph: (...a: unknown[]) => ideGraph(...a),
    ideCompare: vi.fn(),
  }),
}));

const remoteInstance = {
  kind: "remote" as const, deviceId: "dev1", name: "laptop", version: "0.5.0", protocol: 1,
  capabilities: ["sessions:read"] as RemoteCapability[],
};

beforeEach(() => {
  ideTree.mockReset().mockResolvedValue({ files: ["a.md"], dirs: [] });
  ideWorkingStatus.mockReset().mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
  ideFile.mockReset().mockResolvedValue({ path: "a.md", content: "# hi", binary: false });
  ideFileDiff.mockReset().mockResolvedValue({ path: "a.md", diff: "", binary: false });
  ideGraph.mockReset().mockResolvedValue({ commits: [], current: "main", total: 0 });
});
afterEach(() => vi.clearAllMocks());

describe("IdeReadPanel (SPEC-1218 · AC-C1)", () => {
  it("merender tree+file+workingStatus dari useApi(), nol tombol tulis", async () => {
    render(<InstanceProvider value={remoteInstance}><IdeReadPanel projectId="p1" /></InstanceProvider>);
    await vi.waitFor(() => expect(ideTree).toHaveBeenCalledWith("p1", ""));
    expect(ideWorkingStatus).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("button", { name: /commit|hapus|rename|ganti nama|unggah/i })).not.toBeInTheDocument();
  });
});
