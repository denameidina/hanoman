import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpecDocsModal } from "../src/screens/SpecDocsModal";
import { InstanceProvider } from "../src/api/instance";

const localGetSpecDocs = vi.fn();
const remoteGetSpecDocs = vi.fn();
vi.mock("../src/api/client", () => ({
  api: { getSpecDocs: (...a: unknown[]) => localGetSpecDocs(...a), getSpecDocFile: vi.fn(), specDocDownloadUrl: vi.fn() },
  createApi: () => ({ getSpecDocs: (...a: unknown[]) => remoteGetSpecDocs(...a), getSpecDocFile: vi.fn(), specDocDownloadUrl: vi.fn() }),
}));

beforeEach(() => { localGetSpecDocs.mockReset().mockResolvedValue({ files: [] }); remoteGetSpecDocs.mockReset().mockResolvedValue({ files: [] }); });
afterEach(() => vi.clearAllMocks());

const remoteInstance = {
  kind: "remote" as const, deviceId: "dev1", name: "laptop", version: "0.5.0", protocol: 1,
  capabilities: ["sessions:read"] as const,
};

describe("SpecDocsModal (SPEC-1218 · AC-C1)", () => {
  it("dalam InstanceContext remote, SpecDocsModal memanggil api instance remote (base /api/devices/:id/relay), bukan api singleton lokal", async () => {
    render(
      <InstanceProvider value={remoteInstance}>
        <SpecDocsModal specId="SPEC-170" onClose={() => {}} />
      </InstanceProvider>,
    );
    await vi.waitFor(() => expect(remoteGetSpecDocs).toHaveBeenCalledWith("SPEC-170"));
    expect(localGetSpecDocs).not.toHaveBeenCalled();
  });
});
