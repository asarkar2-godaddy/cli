/**
 * Runtime loader for the API catalog.
 *
 * The pre-generated JSON files (produced by scripts/generate-api-catalog.ts)
 * are imported directly so esbuild inlines them into the bundle. All public
 * functions return Effect values — file I/O is resolved at build time, but
 * the catalog access pattern stays within the Effect pipeline.
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

// ---------------------------------------------------------------------------
// Static imports — esbuild inlines these at bundle time
// ---------------------------------------------------------------------------

import manifestJson from "./manifest.json";
import { DOMAIN_REGISTRY } from "./registry.generated";

// ---------------------------------------------------------------------------
// Types (match the generate-api-catalog output)
// ---------------------------------------------------------------------------

export interface CatalogParameter {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface CatalogRequestBody {
  required: boolean;
  description?: string;
  contentType: string;
  schema?: Record<string, unknown>;
}

export interface CatalogResponse {
  description: string;
  schema?: Record<string, unknown>;
}

export interface CatalogEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  parameters?: CatalogParameter[];
  requestBody?: CatalogRequestBody;
  responses: Record<string, CatalogResponse>;
  scopes: string[];
}

export interface CatalogDomain {
  name: string;
  title: string;
  description: string;
  version: string;
  baseUrl: string;
  endpoints: CatalogEndpoint[];
}

interface ManifestEntry {
  file: string;
  title: string;
  endpointCount: number;
}

interface CatalogManifest {
  generated: string;
  domains: Record<string, ManifestEntry>;
}

// ---------------------------------------------------------------------------
// Domain registry — generated at build time by generate-api-catalog.ts
// ---------------------------------------------------------------------------

const domainRegistry = DOMAIN_REGISTRY as Record<string, CatalogDomain>;

const manifest = manifestJson as unknown as CatalogManifest;

// ---------------------------------------------------------------------------
// Public API — all return Effect values
// ---------------------------------------------------------------------------

/**
 * Load the catalog manifest.
 */
export function loadManifestEffect(): Effect.Effect<CatalogManifest> {
  return Effect.succeed(manifest);
}

/**
 * List all available API domain names.
 */
export function listDomainNamesEffect(): Effect.Effect<string[]> {
  return Effect.succeed(Object.keys(manifest.domains));
}

/**
 * Get manifest metadata for all domains.
 */
export function listDomainsEffect(): Effect.Effect<
  Array<{ name: string; title: string; endpointCount: number }>
> {
  return Effect.succeed(
    Object.entries(manifest.domains).map(([name, entry]) => ({
      name,
      title: entry.title,
      endpointCount: entry.endpointCount,
    })),
  );
}

/**
 * Load a single API domain catalog by name.
 * Returns Option.none() if the domain is not in the registry.
 */
export function loadDomainEffect(
  name: string,
): Effect.Effect<Option.Option<CatalogDomain>> {
  const domain = domainRegistry[name];
  return Effect.succeed(domain ? Option.some(domain) : Option.none());
}

/**
 * Find an endpoint by operation ID across all domains.
 */
export function findEndpointByOperationIdEffect(
  operationId: string,
): Effect.Effect<
  Option.Option<{ domain: CatalogDomain; endpoint: CatalogEndpoint }>
> {
  return Effect.sync(() => {
    for (const domain of Object.values(domainRegistry)) {
      const endpoint = domain.endpoints.find(
        (e) => e.operationId === operationId,
      );
      if (endpoint) return Option.some({ domain, endpoint });
    }
    return Option.none();
  });
}

/**
 * Find an endpoint by HTTP method + path across all domains.
 */
export function findEndpointByPathEffect(
  method: string,
  apiPath: string,
): Effect.Effect<
  Option.Option<{ domain: CatalogDomain; endpoint: CatalogEndpoint }>
> {
  return Effect.sync(() => {
    const upperMethod = method.toUpperCase();
    for (const domain of Object.values(domainRegistry)) {
      const endpoint = domain.endpoints.find(
        (e) => e.method === upperMethod && e.path === apiPath,
      );
      if (endpoint) return Option.some({ domain, endpoint });
    }
    return Option.none();
  });
}

/**
 * Find an endpoint by path, trying all common HTTP methods.
 */
export function findEndpointByAnyMethodEffect(
  apiPath: string,
): Effect.Effect<
  Option.Option<{ domain: CatalogDomain; endpoint: CatalogEndpoint }>
> {
  return Effect.gen(function* () {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const result = yield* findEndpointByPathEffect(method, apiPath);
      if (Option.isSome(result)) return result;
    }
    return Option.none();
  });
}

/**
 * Search endpoints by keyword (matches against operationId, summary,
 * description, and path).
 */
export function searchEndpointsEffect(
  query: string,
): Effect.Effect<Array<{ domain: CatalogDomain; endpoint: CatalogEndpoint }>> {
  return Effect.sync(() => {
    const lower = query.toLowerCase();
    const results: Array<{
      domain: CatalogDomain;
      endpoint: CatalogEndpoint;
    }> = [];

    for (const domain of Object.values(domainRegistry)) {
      for (const endpoint of domain.endpoints) {
        const searchable = [
          endpoint.operationId,
          endpoint.summary,
          endpoint.description || "",
          endpoint.path,
          endpoint.method,
        ]
          .join(" ")
          .toLowerCase();

        if (searchable.includes(lower)) {
          results.push({ domain, endpoint });
        }
      }
    }

    return results;
  });
}
