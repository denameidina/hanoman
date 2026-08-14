/* Renderer Markdown bersama (marked + DOMPurify + kelas `.hn-md`). Diangkat dari DocsWorkspace
   (SPEC-170) supaya seluruh preview memakai satu renderer dan satu kebijakan keamanan. */
import DOMPurify from "dompurify";
import React from "react";
import { marked } from "marked";

const MARKDOWN_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "img", "input", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th",
  "thead", "tr", "ul",
];
const MARKDOWN_ATTRS = ["align", "alt", "checked", "class", "disabled", "href", "src", "start", "title", "type"];
const URL_ATTRS = ["href", "src"] as const;
const SAFE_HREF_SCHEMES = new Set(["http", "https", "mailto"]);
const SAFE_SRC_SCHEMES = new Set(["http", "https"]);

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function safeUrl(value: string, attribute: typeof URL_ATTRS[number]) {
  const normalized = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  if (!scheme) return true;
  return (attribute === "href" ? SAFE_HREF_SCHEMES : SAFE_SRC_SCHEMES).has(scheme);
}

function allowedClasses(element: Element) {
  const tag = element.tagName.toLowerCase();
  const allowed = tag === "ul" ? new Set(["contains-task-list"])
    : tag === "li" ? new Set(["task-list-item"])
      : null;
  return element.className.split(/\s+/).filter((name) =>
    allowed?.has(name) || (tag === "code" && /^language-[\w-]+$/.test(name)));
}

function sanitizeMarkdownHtml(html: string) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_TAGS,
    ALLOWED_ATTR: MARKDOWN_ATTRS,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;

  for (const element of template.content.querySelectorAll("[href], [src]")) {
    for (const attribute of URL_ATTRS) {
      const value = element.getAttribute(attribute);
      if (value !== null && !safeUrl(value, attribute)) element.removeAttribute(attribute);
    }
  }
  for (const element of template.content.querySelectorAll("[class]")) {
    const classes = allowedClasses(element);
    if (classes.length) element.setAttribute("class", classes.join(" "));
    else element.removeAttribute("class");
  }
  for (const input of template.content.querySelectorAll("input")) {
    if (input.getAttribute("type")?.toLowerCase() !== "checkbox") input.remove();
    else input.setAttribute("disabled", "");
  }
  return template.innerHTML;
}

function hnRender(md: string) {
  try {
    const parsed = marked.parse(md || "", { gfm: true, breaks: false }) as string;
    return sanitizeMarkdownHtml(parsed);
  } catch {
    return "<pre>" + escapeHtml(String(md || "")) + "</pre>";
  }
}
function hnLang(name: string) {
  return /\.json$/.test(name) ? "json" : /\.toml$/.test(name) ? "toml"
    : /\.ya?ml$/.test(name) ? "yaml" : /\.(ts|tsx|js)$/.test(name) ? "ts" : "";
}
/* SPEC-385 · satu-satunya definisi "berkas markdown" untuk frontend. Dulu hidup sebagai const
   lokal `isMarkdown` di IdeScreen; kini dipakai IDE, Git Graph, dan Review sekaligus. */
export const isMarkdownPath = (p: string): boolean => /\.md$/i.test(p);

export function hnDocHtml(text: string, name: string) {
  const md = /\.md$/.test(name) ? (text || "") : ("```" + hnLang(name) + "\n" + (text || "") + "\n```");
  return hnRender(md);
}
export function MarkdownView({ text, name }: { text: string; name: string }) {
  return <div className="hn-md" dangerouslySetInnerHTML={{ __html: hnDocHtml(text, name) }} />;
}
