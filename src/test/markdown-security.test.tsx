import DOMPurify from "dompurify";
import { render } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, hnDocHtml } from "../src/ds/markdown";

function htmlRoot(markdown: string) {
  const root = document.createElement("div");
  root.innerHTML = hnDocHtml(markdown, "README.md");
  return root;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

afterEach(() => vi.restoreAllMocks());

describe("MarkdownView security", () => {
  it.each([
    "<script>globalThis.__hanomanXss=1</script>",
    "<iframe srcdoc='<script>globalThis.__hanomanXss=1</script>'></iframe>",
    "<object data='data:text/html,<script>globalThis.__hanomanXss=1</script>'></object>",
    "<svg><g onload='globalThis.__hanomanXss=1'></g></svg>",
    "<math><mi xlink:href='data:x,<script>globalThis.__hanomanXss=1</script>'></mi></math>",
  ])("membuang elemen aktif dari %s", (markdown) => {
    const root = htmlRoot(markdown);
    expect(root.querySelector("script, iframe, object, embed, form, style, svg, math")).toBeNull();
  });

  it.each([
    "<img src=x onerror='globalThis.__hanomanXss=1'>",
    "<IMG SRC=x OnErRoR='globalThis.__hanomanXss=1'>",
    "<p onmouseover='globalThis.__hanomanXss=1'>hover</p>",
  ])("membuang event handler termasuk case dan markup malformed dari %s", (markdown) => {
    const root = htmlRoot(markdown);
    const handlers = Array.from(root.querySelectorAll("*")).flatMap((node) =>
      Array.from(node.attributes).filter((attribute) => /^on/i.test(attribute.name)));
    expect(handlers).toEqual([]);
  });

  it.each([
    ["[klik](JaVaScRiPt:globalThis.__hanomanXss=1)", "a", "href"],
    ["<a href='jav&#x61;script:globalThis.__hanomanXss=1'>klik</a>", "a", "href"],
    ["<a href='java&#10;script:globalThis.__hanomanXss=1'>klik</a>", "a", "href"],
    ["<img src='vbscript:msgbox(1)'>", "img", "src"],
    ["<img src='data:image/svg+xml,<svg onload=alert(1)>'>", "img", "src"],
    ["<a href='ftp://example.com/rahasia'>ftp</a>", "a", "href"],
    ["<img src='mailto:a@example.com'>", "img", "src"],
  ])("membuang URL aktif atau scheme yang tidak diizinkan dari %s", (markdown, selector, attribute) => {
    expect(htmlRoot(markdown).querySelector(selector)).not.toHaveAttribute(attribute);
  });

  it("tetap aman setelah sanitizer dan sink me-reparse markup mutation-XSS", () => {
    const root = htmlRoot('<svg><p><style><g title="</style><img src=x onerror=globalThis.__hanomanXss=1>">');
    expect(root.querySelector("svg, style, [onerror]")).toBeNull();
  });

  it("meng-escape sumber ke pre bila sanitizer gagal", () => {
    vi.spyOn(DOMPurify, "sanitize").mockImplementationOnce(() => { throw new Error("sanitizer gagal"); });
    const html = hnDocHtml('<img src=x onerror="globalThis.__hanomanXss=1">', "README.md");
    expect(html).toBe('<pre>&lt;img src=x onerror="globalThis.__hanomanXss=1"&gt;</pre>');
  });

  it("mempertahankan Markdown dan GFM aman", () => {
    const root = htmlRoot([
      "# Judul",
      "",
      "**tebal** dan [relatif](docs/a.md) serta [web](https://example.com) dan [email](mailto:a@example.com)",
      "",
      "![gambar](assets/a.png \"judul\")",
      "",
      "- [x] selesai",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n"));

    expect(root.querySelector("h1")?.textContent).toBe("Judul");
    expect(root.querySelector("strong")?.textContent).toBe("tebal");
    expect(Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href")))
      .toEqual(["docs/a.md", "https://example.com", "mailto:a@example.com"]);
    expect(root.querySelector("img")).toMatchObject({ alt: "gambar" });
    expect(root.querySelector("img")).toHaveAttribute("src", "assets/a.png");
    expect(root.querySelector("input")).toHaveAttribute("type", "checkbox");
    expect(root.querySelector("input")).toBeDisabled();
    expect(root.querySelector("input")).toBeChecked();
    expect(root.querySelector("table td")?.textContent).toBe("1");
    expect(root.querySelector("code")?.textContent).toContain("const answer = 42;");
  });

  it("memasang hanya DOM hasil sanitasi", () => {
    const { container } = render(<MarkdownView
      name="README.md"
      text={'<img src=x onerror="globalThis.__hanomanXss=1"><svg onload="globalThis.__hanomanXss=1" />'}
    />);
    expect(container.querySelector("svg, [onerror], [onload]")).toBeNull();
  });
});

describe("kontrak titik cekik preview Markdown", () => {
  it("seluruh permukaan preview tetap memakai renderer bersama", () => {
    const cwd = process.cwd();
    const appRoot = [resolve(cwd, "src"), resolve(cwd, "src/src")].find((path) =>
      existsSync(resolve(path, "ds/markdown.tsx")));
    expect(appRoot).toBeTruthy();

    const surfaces = [
      "ds/DocPreviewModal.tsx",
      "screens/AgentDocCard.tsx",
      "screens/ChangelogScreen.tsx",
      "screens/DocsWorkspace.tsx",
      "screens/GitGraph.tsx",
      "screens/IdeScreen.tsx",
      "screens/PrdScreen.tsx",
      "screens/ReviewScreen.tsx",
      "screens/SpecDocsModal.tsx",
    ];
    for (const file of surfaces) {
      const source = readFileSync(resolve(appRoot!, file), "utf8");
      expect(source, `${file} melewati renderer bersama`)
        .toMatch(/<(?:MarkdownView|DocPreviewModal)\b/);
    }

    const parserOwners = sourceFiles(appRoot!)
      .filter((file) => readFileSync(file, "utf8").includes("marked.parse("))
      .map((file) => file.slice(appRoot!.length + 1));
    expect(parserOwners).toEqual(["ds/markdown.tsx"]);
  });
});
