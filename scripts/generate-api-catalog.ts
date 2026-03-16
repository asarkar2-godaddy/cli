/**
 * Build-time script: reads OpenAPI specs from specification submodules and
 * produces a JSON catalog that the CLI bundles for `godaddy api list / describe`.
 *
 * Resolves external $ref URLs (e.g. schemas.api.godaddy.com) at build time
 * so the CLI catalog is fully self-contained.
 *
 * Usage:
 *   pnpm tsx scripts/generate-api-catalog.ts
 *
 * Output:
 *   src/cli/schemas/api/manifest.json   – domain index
 *   src/cli/schemas/api/<domain>.json   – per-domain endpoint catalog
 */

import { lookup } from "node:dns/promises";
import * as fs from "node:fs";
import { isIP } from "node:net";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse | { $ref: string }>;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiPathItem {
  [method: string]: OpenApiOperation | OpenApiParameter[] | undefined;
  parameters?: OpenApiParameter[];
}

interface OpenApiServer {
  url: string;
  variables?: Record<string, { default: string; enum?: string[] }>;
}

interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: Record<string, string>;
  };
  paths: Record<string, OpenApiPathItem>;
  servers?: OpenApiServer[];
  components?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Output types — what the CLI consumes at runtime
// ---------------------------------------------------------------------------

interface CatalogEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required: boolean;
    description?: string;
    schema?: Record<string, unknown>;
  }>;
  requestBody?: {
    required: boolean;
    description?: string;
    contentType: string;
    schema?: Record<string, unknown>;
  };
  responses: Record<
    string,
    {
      description: string;
      schema?: Record<string, unknown>;
    }
  >;
  scopes: string[];
}

interface CatalogDomain {
  name: string;
  title: string;
  description: string;
  version: string;
  baseUrl: string;
  endpoints: CatalogEndpoint[];
}

interface CatalogManifest {
  generated: string;
  domains: Record<
    string,
    { file: string; title: string; endpointCount: number }
  >;
}

// ---------------------------------------------------------------------------
// Spec source registry — add new spec submodules here
// ---------------------------------------------------------------------------

interface SpecSource {
  /** Domain key used in the CLI (e.g. "location-addresses") */
  domain: string;
  /** Relative path from workspace root to the OpenAPI YAML file */
  specPath: string;
}

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.resolve(__dirname, "../src/cli/schemas/api");

const SPEC_SOURCES: SpecSource[] = [
  {
    domain: "location-addresses",
    specPath: "location.addresses-specification/v1/schemas/openapi.yaml",
  },
  // Add more spec submodules here as they become available:
  // { domain: "catalog", specPath: "catalog-specification/v1/schemas/openapi.yaml" },
];

const ALLOWED_REF_HOSTS = new Set(["schemas.api.godaddy.com"]);
const MAX_REF_REDIRECTS = 5;
const MAX_REF_BYTES = 1_000_000; // 1 MB
const REF_FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// External $ref resolution
// ---------------------------------------------------------------------------

const refCache = new Map<string, Record<string, unknown>>();
const hostValidationCache = new Set<string>();

function isPrivateOrReservedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part)))
      return true;
    const [a, b] = parts;

    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 0) return true;
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a === 198 && b === 51) return true; // TEST-NET-2
    if (a === 203 && b === 0) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return true; // link-local
    }
    if (lower.startsWith("2001:db8")) return true; // documentation range
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice("::ffff:".length);
      if (isIP(mapped) === 4) {
        return isPrivateOrReservedIp(mapped);
      }
    }
    return false;
  }

  return true;
}

function validateRefUrl(urlString: string): URL {
  const parsed = new URL(urlString);

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Blocked external $ref '${urlString}': only https URLs are allowed`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `Blocked external $ref '${urlString}': credentialed URLs are not allowed`,
    );
  }

  if (parsed.port && parsed.port !== "443") {
    throw new Error(
      `Blocked external $ref '${urlString}': non-default HTTPS ports are not allowed`,
    );
  }

  if (!ALLOWED_REF_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Blocked external $ref '${urlString}': host '${parsed.hostname}' is not allowlisted`,
    );
  }

  return parsed;
}

async function validateResolvedHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (hostValidationCache.has(host)) return;

  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(
      `Blocked external $ref '${url}': DNS lookup returned no IPs`,
    );
  }

  for (const record of addresses) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(
        `Blocked external $ref '${url}': host resolves to private/reserved IP ${record.address}`,
      );
    }
  }

  hostValidationCache.add(host);
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    const size = Buffer.byteLength(text, "utf8");
    if (size > maxBytes) {
      throw new Error(
        `External $ref response exceeded ${maxBytes} bytes (${size} bytes)`,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(
        `External $ref response exceeded ${maxBytes} bytes while streaming`,
      );
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

async function fetchWithValidation(
  initialUrl: string,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= MAX_REF_REDIRECTS; redirects++) {
    const parsed = validateRefUrl(currentUrl);
    await validateResolvedHost(parsed);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REF_FETCH_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Timed out fetching external $ref '${currentUrl}' after ${REF_FETCH_TIMEOUT_MS}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(
          `External $ref redirect from '${currentUrl}' missing Location header`,
        );
      }
      if (redirects === MAX_REF_REDIRECTS) {
        throw new Error(
          `Too many redirects while fetching external $ref '${initialUrl}'`,
        );
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const finalUrl = response.url || currentUrl;
    const finalParsed = validateRefUrl(finalUrl);
    await validateResolvedHost(finalParsed);

    return { response, finalUrl };
  }

  throw new Error(
    `Unexpected redirect handling failure for external $ref '${initialUrl}'`,
  );
}

async function fetchExternalRef(url: string): Promise<Record<string, unknown>> {
  const cached = refCache.get(url);
  if (cached) return cached;

  console.log(`    Fetching external $ref: ${url}`);
  const { response, finalUrl } = await fetchWithValidation(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch external $ref '${finalUrl}': ${response.status}`,
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > MAX_REF_BYTES) {
      throw new Error(
        `External $ref '${finalUrl}' is too large (${size} bytes > ${MAX_REF_BYTES})`,
      );
    }
  }

  const text = await readResponseTextWithLimit(response, MAX_REF_BYTES);
  let parsed: Record<string, unknown>;
  const finalPath = new URL(finalUrl).pathname.toLowerCase();
  try {
    if (finalPath.endsWith(".yaml") || finalPath.endsWith(".yml")) {
      parsed = parseYaml(text) as Record<string, unknown>;
    } else {
      parsed = JSON.parse(text) as Record<string, unknown>;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse external $ref '${finalUrl}': ${message}`);
  }

  // Strip JSON Schema meta-fields that add noise for agents
  const { $id, $schema, ...rest } = parsed;
  const cleaned = rest as Record<string, unknown>;

  refCache.set(finalUrl, cleaned);
  refCache.set(url, cleaned);
  return cleaned;
}

/**
 * Resolve a potentially relative $ref URL against a base URL.
 * "./country-code.yaml" resolved against
 * "https://schemas.api.godaddy.com/common-types/v1/schemas/yaml/address.yaml"
 * becomes "https://schemas.api.godaddy.com/common-types/v1/schemas/yaml/country-code.yaml"
 */
function resolveRefUrl(ref: string, baseUrl?: string): string | null {
  if (ref.startsWith("https://") || ref.startsWith("http://")) return ref;
  if (ref.startsWith("#")) return null; // local JSON pointer — skip
  if (!baseUrl) return null;
  // Relative path: resolve against the base URL's directory
  const base = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
  return new URL(ref, base).toString();
}

/**
 * Walk an object tree and resolve any { $ref: "..." } nodes by
 * fetching the URL and inlining the result. Resolves both absolute
 * and relative $refs (relative to parentUrl). Local JSON pointer
 * refs (e.g. "#/components/schemas/Foo") are left as-is.
 */
async function resolveRefs(obj: unknown, parentUrl?: string): Promise<unknown> {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return Promise.all(obj.map((item) => resolveRefs(item, parentUrl)));
  }

  const record = obj as Record<string, unknown>;

  // Check if this node is a $ref
  if (typeof record.$ref === "string") {
    const resolvedUrl = resolveRefUrl(record.$ref, parentUrl);
    if (resolvedUrl) {
      const resolved = await fetchExternalRef(resolvedUrl);
      // Preserve sibling properties (e.g. "description" next to "$ref")
      const { $ref, ...siblings } = record;
      const merged = { ...resolved, ...siblings };
      // Recursively resolve any nested $refs, using this URL as the new base
      return resolveRefs(merged, resolvedUrl);
    }
  }

  // Recurse into all properties
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = await resolveRefs(value, parentUrl);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
]);

function resolveBaseUrl(servers?: OpenApiServer[]): string {
  if (!servers || servers.length === 0) return "";
  const server = servers[0];
  let url = server.url;
  if (server.variables) {
    for (const [key, variable] of Object.entries(server.variables)) {
      url = url.replace(`{${key}}`, variable.default);
    }
  }
  return url;
}

function extractScopes(security?: Array<Record<string, string[]>>): string[] {
  if (!security) return [];
  const scopes: string[] = [];
  for (const entry of security) {
    for (const scopeList of Object.values(entry)) {
      scopes.push(...scopeList);
    }
  }
  return [...new Set(scopes)];
}

function processOperation(
  httpMethod: string,
  pathStr: string,
  operation: OpenApiOperation,
  pathLevelParams?: OpenApiParameter[],
): CatalogEndpoint {
  // Merge path-level and operation-level parameters
  const allParams = [
    ...(pathLevelParams || []),
    ...(operation.parameters || []),
  ];

  const parameters = allParams.map((p) => ({
    name: p.name,
    in: p.in,
    required: p.required ?? false,
    description: p.description,
    schema: p.schema,
  }));

  // Process request body
  let requestBody: CatalogEndpoint["requestBody"];
  if (operation.requestBody) {
    const rb = operation.requestBody;
    const contentTypes = rb.content ? Object.keys(rb.content) : [];
    const primaryCt = contentTypes[0] || "application/json";
    const schema = rb.content?.[primaryCt]?.schema;

    requestBody = {
      required: rb.required ?? false,
      description: rb.description,
      contentType: primaryCt,
      schema: schema,
    };
  }

  // Process responses (skip $ref responses that we can't resolve inline)
  const responses: CatalogEndpoint["responses"] = {};
  if (operation.responses) {
    for (const [status, resp] of Object.entries(operation.responses)) {
      if ("$ref" in resp) {
        responses[status] = {
          description: `See ${(resp as { $ref: string }).$ref}`,
        };
        continue;
      }
      const contentTypes = resp.content ? Object.keys(resp.content) : [];
      const primaryCt = contentTypes[0] || "application/json";
      responses[status] = {
        description: resp.description || "",
        schema: resp.content?.[primaryCt]?.schema,
      };
    }
  }

  // Generate a stable operationId if missing
  const operationId =
    operation.operationId ||
    `${httpMethod}${pathStr.replace(/[^a-zA-Z0-9]/g, "_")}`;

  return {
    operationId,
    method: httpMethod.toUpperCase(),
    path: pathStr,
    summary: operation.summary || "",
    description: operation.description,
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody,
    responses,
    scopes: extractScopes(operation.security),
  };
}

function processSpec(spec: OpenApiSpec, domain: string): CatalogDomain {
  const baseUrl = resolveBaseUrl(spec.servers);
  const endpoints: CatalogEndpoint[] = [];

  for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
    const pathLevelParams = pathItem.parameters as
      | OpenApiParameter[]
      | undefined;

    for (const [key, value] of Object.entries(pathItem)) {
      if (key === "parameters" || !HTTP_METHODS.has(key) || !value) continue;
      const operation = value as OpenApiOperation;
      endpoints.push(
        processOperation(key, pathStr, operation, pathLevelParams),
      );
    }
  }

  return {
    name: domain,
    title: spec.info.title,
    description: spec.info.description || "",
    version: spec.info.version,
    baseUrl,
    endpoints,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifest: CatalogManifest = {
    generated: new Date().toISOString(),
    domains: {},
  };

  let totalEndpoints = 0;

  for (const source of SPEC_SOURCES) {
    const specFile = path.join(WORKSPACE_ROOT, source.specPath);

    if (!fs.existsSync(specFile)) {
      console.error(`WARNING: spec not found: ${specFile} — skipping`);
      continue;
    }

    const raw = fs.readFileSync(specFile, "utf-8");
    const spec = parseYaml(raw) as OpenApiSpec;
    const catalog = processSpec(spec, source.domain);

    // Resolve all external $refs in the catalog
    console.log(`  Resolving external $refs for ${source.domain}...`);
    const resolved = (await resolveRefs(catalog)) as CatalogDomain;

    const filename = `${source.domain}.json`;

    fs.writeFileSync(
      path.join(OUTPUT_DIR, filename),
      JSON.stringify(resolved, null, "\t"),
      "utf-8",
    );

    manifest.domains[source.domain] = {
      file: filename,
      title: resolved.title,
      endpointCount: resolved.endpoints.length,
    };

    totalEndpoints += resolved.endpoints.length;
    console.log(
      `  ${source.domain}: ${resolved.endpoints.length} endpoints from ${spec.info.title} v${spec.info.version}`,
    );
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, "\t"),
    "utf-8",
  );

  console.log(
    `\nGenerated API catalog: ${Object.keys(manifest.domains).length} domains, ${totalEndpoints} endpoints`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
