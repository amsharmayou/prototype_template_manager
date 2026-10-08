import { escapeHtml } from "@/lib/render/escape";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Assemble the single `.html` file that carries a template to someone else.
 *
 * The file has to work with no server, no build step and no network, so it holds
 * everything it needs twice over: the share runtime as inline script, and the
 * template as JSON the runtime derives the form from. Opening the file is
 * therefore the whole install step.
 */

/**
 * JSON safe to sit inside a `<script>` element.
 *
 * `</script` inside any string - a customer called "</script>", a template name
 * with an angle bracket - would close the element early and turn the rest of the
 * payload into markup the browser executes. Escaping `<` as `<` keeps the JSON
 * valid, since no JSON escape sequence uses it, and makes the closing tag
 * unreachable in the one context it is dangerous.
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Kill a script block the kit source itself could otherwise close. */
function safeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

export function buildShareDocument(template: BillTemplate, kitSource: string): string {
  const title = escapeHtml(template.meta?.name || "Document");
  return (
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${title}</title>\n` +
    `<style>html,body{height:100%;margin:0}</style>\n` +
    `</head>\n<body>\n` +
    `<div id="share-app"></div>\n` +
    `<iframe id="share-preview" title="Preview"></iframe>\n` +
    `<script type="application/json" id="share-template">${embedJson(template)}</script>\n` +
    `<script>${safeScript(kitSource)}</script>\n` +
    `<script>\n` +
    `window.bootShareKit(\n` +
    `  document.getElementById("share-app"),\n` +
    `  JSON.parse(document.getElementById("share-template").textContent),\n` +
    `  document.getElementById("share-preview"),\n` +
    `);\n` +
    `</script>\n` +
    `</body>\n</html>\n`
  );
}