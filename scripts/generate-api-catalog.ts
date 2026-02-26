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

import * as fs from "node:fs";
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

// ---------------------------------------------------------------------------
// External $ref resolution
// ---------------------------------------------------------------------------

const refCache = new Map<string, Record<string, unknown>>();

async function fetchExternalRef(
	url: string,
): Promise<Record<string, unknown>> {
	const cached = refCache.get(url);
	if (cached) return cached;

	console.log(`    Fetching external $ref: ${url}`);
	const resp = await fetch(url);
	if (!resp.ok) {
		console.error(`    WARNING: failed to fetch ${url}: ${resp.status}`);
		return { $ref: url, _unresolved: true };
	}

	const text = await resp.text();
	let parsed: Record<string, unknown>;
	if (url.endsWith(".yaml") || url.endsWith(".yml")) {
		parsed = parseYaml(text) as Record<string, unknown>;
	} else {
		parsed = JSON.parse(text) as Record<string, unknown>;
	}

	// Strip JSON Schema meta-fields that add noise for agents
	const { $id, $schema, ...rest } = parsed;
	const cleaned = rest as Record<string, unknown>;

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
async function resolveRefs(
	obj: unknown,
	parentUrl?: string,
): Promise<unknown> {
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
