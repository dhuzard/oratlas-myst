import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME, exportProject } from "../src/export.js";
import { sha256 } from "../src/hash.js";
import { isSafeRelativePath } from "../src/contracts/index.js";
import { resolvePublishedUrl } from "../src/resolve-url.js";

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const EXAMPLE = join(REPO_ROOT, "examples", "basic");
const PLUGIN_BUNDLE = join(REPO_ROOT, "dist", "oratlas-myst.mjs");

/**
 * Published-structure verification, with no access to the publication source.
 *
 * A deployed MyST site serves HTML, the content JSON, `myst.xref.json` and the
 * ORAtlas artifacts. It does **not** necessarily serve `results.md`. So a
 * consumer holding only the published site cannot check `documentSha256` —
 * that needs source-byte verification, which needs `publication.source`.
 *
 * What such a consumer *can* do is prove that each declared claim really
 * exists in the published structure, which is what these tests exercise. The
 * fixture below is a bag of published bytes read up front; nothing in the
 * verification can reach a `.md` file even by accident.
 */
interface PublishedSite {
  /** Every file the deployed site serves, keyed by site-root-relative path. */
  files: Map<string, string>;
}

function get(site: PublishedSite, path: string): string {
  const normalized = path.replace(/^\//, "");
  const content = site.files.get(normalized);
  if (content === undefined) {
    throw new Error(`Published site does not serve ${normalized}`);
  }
  return content;
}

let workspace: string;
let site: PublishedSite;

beforeAll(() => {
  if (!existsSync(PLUGIN_BUNDLE)) {
    throw new Error(`Missing ${PLUGIN_BUNDLE}. Run \`pnpm run build\` before this test.`);
  }

  workspace = mkdtempSync(join(tmpdir(), "oratlas-myst-published-"));
  cpSync(EXAMPLE, workspace, {
    recursive: true,
    filter: (source) => !source.includes("_build") && !source.includes("node_modules"),
  });
  rmSync(join(workspace, ".oratlas"), { recursive: true, force: true });
  cpSync(PLUGIN_BUNDLE, join(workspace, "oratlas-myst.mjs"));
  cpSync(join(HERE, "fixtures", "site-template"), join(workspace, "_site_template"), {
    recursive: true,
  });
  writeFileSync(
    join(workspace, "myst.yml"),
    readFileSync(join(workspace, "myst.yml"), "utf8")
      .replace("../../dist/oratlas-myst.mjs", "oratlas-myst.mjs")
      .replace("template: book-theme", "template: ./_site_template"),
    "utf8",
  );

  exportProject({ projectRoot: workspace });
  execFileSync("node", [require_.resolve("mystmd/dist/myst.cjs"), "build", "--site"], {
    cwd: workspace,
    stdio: "pipe",
    encoding: "utf8",
  });

  // Assemble exactly what a deployed site serves at its root. `static_files`
  // land in the site's public directory, and MyST writes its own inventory and
  // page data beside them; `myst build --html` puts all of these in one root.
  const siteDir = join(workspace, "_build", "site");
  const files = new Map<string, string>();
  files.set(MANIFEST_FILE_NAME, readFileSync(join(siteDir, "public", MANIFEST_FILE_NAME), "utf8"));
  files.set(
    CLAIMS_ARTIFACT_PATH,
    readFileSync(join(siteDir, "public", CLAIMS_ARTIFACT_PATH), "utf8"),
  );
  files.set("myst.xref.json", readFileSync(join(siteDir, "myst.xref.json"), "utf8"));
  for (const page of ["index", "results"]) {
    files.set(
      `content/${page}.json`,
      readFileSync(join(siteDir, "content", `${page}.json`), "utf8"),
    );
  }
  site = { files };
}, 300_000);

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

function findNode(
  node: Record<string, unknown>,
  predicate: (candidate: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  if (predicate(node)) return node;
  for (const child of (node.children ?? []) as Record<string, unknown>[]) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

describe("published-structure verification", () => {
  it("does not serve the publication source, so source-byte verification is unavailable", () => {
    // This is the whole reason two verification levels exist. The site serves
    // the artifacts and the built content, not the Markdown they came from.
    expect([...site.files.keys()].some((path) => path.endsWith(".md"))).toBe(false);

    const claims = get(site, CLAIMS_ARTIFACT_PATH)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const record of claims) {
      expect(record.source.documentPath).toMatch(/\.md$/);
      expect(site.files.has(record.source.documentPath)).toBe(false);
    }
  });

  it("declares where the source bytes can be obtained instead", () => {
    const manifest = JSON.parse(get(site, MANIFEST_FILE_NAME));
    // Without this, a consumer holding only the site could never reach
    // source-byte verification at all.
    expect(manifest.publication.source).toEqual({
      type: "git",
      repository: "https://github.com/dhuzard/oratlas-myst",
    });
  });

  it("carries an exact publication version identity that needs no source", () => {
    const manifest = JSON.parse(get(site, MANIFEST_FILE_NAME));
    expect(manifest.publication.id).toBe("adolescent-stress-review");
    expect(manifest.publication.version.sourcesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.publication.version.label).toBe("v1.0.0");
  });

  it("verifies every claim against the published structure alone", () => {
    const manifest = JSON.parse(get(site, MANIFEST_FILE_NAME));
    const claimsBytes = get(site, manifest.artifacts.claims.path);

    // 1. The artifact is the one the manifest declares.
    expect(sha256(claimsBytes)).toBe(manifest.artifacts.claims.sha256);

    const claims = claimsBytes
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(claims).toHaveLength(manifest.artifacts.claims.records);

    // 2. Every declared path is safe before anything is resolved.
    for (const path of [manifest.adapter.xref, manifest.artifacts.claims.path]) {
      expect(isSafeRelativePath(path)).toBe(true);
    }

    const xref = JSON.parse(get(site, manifest.adapter.xref));

    for (const record of claims) {
      // 3. The target resolves through MyST's own inventory.
      const reference = xref.references.find(
        (candidate: { identifier?: string }) => candidate.identifier === record.target.identifier,
      );
      expect(reference, `no xref entry for ${record.id}`).toBeDefined();

      // 4. The page data the inventory points at really contains the claim,
      //    with the identifier, the DOM id and the adapter metadata intact.
      const page = JSON.parse(get(site, reference.data));
      const node = findNode(
        page.mdast,
        (candidate) => candidate.identifier === record.target.identifier,
      );
      expect(node, `claim ${record.id} not present in ${reference.data}`).toBeDefined();
      expect(node!.html_id).toBe(record.target.htmlId);
      expect((node!.data as { oratlas?: { kind?: string; id?: string } }).oratlas).toMatchObject({
        kind: "claim",
        id: record.id,
      });

      // 5. The published claim text matches what the record declares. The
      //    record's `text` is derived from the same AST, so this catches an
      //    artifact that was edited apart from the publication it describes.
      const rendered = JSON.stringify(node);
      const firstSentence = String(record.text).split(/[.\n]/)[0]!.slice(0, 40);
      expect(rendered).toContain(
        firstSentence.replace(/\s+/g, " ").split(" ").slice(0, 4).join(" "),
      );
    }
  });

  it("resolves each claim to an absolute published URL", () => {
    const manifest = JSON.parse(get(site, MANIFEST_FILE_NAME));
    const xref = JSON.parse(get(site, manifest.adapter.xref));
    const claims = get(site, manifest.artifacts.claims.path)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    for (const record of claims) {
      const reference = xref.references.find(
        (candidate: { identifier?: string }) => candidate.identifier === record.target.identifier,
      );
      const url = resolvePublishedUrl(
        manifest.publication.canonicalUrl,
        reference.url,
        record.target.htmlId,
      );
      // The publication is deployed under a subpath, so the prefix must
      // survive resolution.
      expect(url).toMatch(/^https:\/\/example\.org\/adolescent-stress\//);
      expect(url).toContain(`#${record.target.htmlId}`);
    }
  });

  it("keeps a subpath deploy intact when resolving an xref URL", () => {
    // The trap this guards: xref URLs are site-root-relative, so resolving one
    // directly against a canonical URL with a path silently drops the path.
    expect(new URL("/results", "https://example.org/review/").href).toBe(
      "https://example.org/results",
    );
    expect(resolvePublishedUrl("https://example.org/review/", "/results")).toBe(
      "https://example.org/review/results",
    );
    expect(resolvePublishedUrl("https://example.org/review", "/")).toBe(
      "https://example.org/review/",
    );
    expect(resolvePublishedUrl("https://example.org/review/", "/", "claim-1")).toBe(
      "https://example.org/review/#claim-1",
    );
  });

  it("keeps the adapter type generic so a consumer need not assume MyST", () => {
    const manifest = JSON.parse(get(site, MANIFEST_FILE_NAME));
    expect(manifest.adapter.type).toBe("myst");

    const claims = get(site, manifest.artifacts.claims.path)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const record of claims) {
      // A consumer switches on `target.type`; `identifier` is the one field
      // every target variant is guaranteed to carry.
      expect(record.target.type).toBe("myst-xref");
      expect(typeof record.target.identifier).toBe("string");
    }
  });
});
