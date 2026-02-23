import { type } from "arktype";
import * as Effect from "effect/Effect";
import { graphql } from "gql.tada";
import { ClientError, request } from "graphql-request";
import { getRequestHeaders, initApiBaseUrl } from "./http-helpers";

const ApplicationQuery = graphql(`
  query Application($name: String!) {
    application(name: $name) {
      id
      label
      name
      description
      status
      url
      proxyUrl
    }
  }
`);

const ApplicationWithLatestReleaseQuery = graphql(`
  query ApplicationWithLatestRelease($name: String!) {
    application(name: $name) {
      id
      label
      name
      description
      status
      url
      proxyUrl
      authorizationScopes
      releases(first: 1, orderBy: { createdAt: DESC }) {
        edges {
          node {
            id
            version
            description
            createdAt
          }
        }
      }
    }
  }
`);

const ApplicationsListQuery = graphql(`
  query ApplicationsList {
    applications {
      id
      label
      name
      description
      status
      url
      proxyUrl
    }
  }
`);

export const CreateApplicationMutation = graphql(`
  mutation CreateApplication($input: MutationCreateApplicationInput!) {
    createApplication(input: $input) {
      id
      clientId
      clientSecret
      label
      name
      description
      status
      url
      proxyUrl
      authorizationScopes
      secret
      publicKey
    }
  }
`);

export const UpdateApplicationMutation = graphql(`
  mutation UpdateApplication(
    $id: String!
    $input: MutationUpdateApplicationInput!
  ) {
    updateApplication(id: $id, input: $input) {
      id
      clientId
      label
      name
      description
      status
      url
      proxyUrl
      authorizationScopes
    }
  }
`);

export const CreateReleaseMutation = graphql(`
  mutation CreateRelease($input: MutationCreateReleaseInput!) {
    createRelease(input: $input) {
      id
      version
      description
      createdAt
    }
  }
`);

export const EnableApplicationMutation = graphql(`
  mutation EnableApplication($input: MutationEnableStoreApplicationInput!) {
    enableStoreApplication(input: $input) {
      id
    }
  }
`);

export const DisableApplicationMutation = graphql(`
  mutation DisableApplication($input: MutationDisableStoreApplicationInput!) {
    disableStoreApplication(input: $input) {
      id
    }
  }
`);

export const ArchiveApplicationMutation = graphql(`
  mutation ArchiveApplication($id: String!) {
    archiveApplication(id: $id) {
      id
      label
      name
      status
      createdAt
      archivedAt
    }
  }
`);

export const applicationInput = type({
	label: "string",
	name: "string",
	description: "string",
	url: type.keywords.string.url.root,
	proxyUrl: type.keywords.string.url.root,
	authorizationScopes: type.string.array().moreThanLength(0),
});

export const updateApplicationInput = type({
	label: "string?",
	description: "string?",
	status: '"ACTIVE" | "INACTIVE"?',
});

async function createApplicationPromise(
	input: typeof applicationInput.infer,
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	const inputParseResult = applicationInput(input);
	if (inputParseResult instanceof type.errors) {
		throw new Error(inputParseResult.summary);
	}

	try {
		const baseUrl = await initApiBaseUrl();

		const result = await request(
			baseUrl,
			CreateApplicationMutation,
			{ input: inputParseResult },
			getRequestHeaders(accessToken),
		);

		return result;
	} catch (err) {
		if (err instanceof ClientError) {
			const graphqlErrors = err.response.errors;
			if (graphqlErrors?.length) {
				const error = graphqlErrors[0];
				const errorCode = error.extensions?.code;
				const errorMessage = errorCode
					? `${error.message} (${errorCode})`
					: error.message;
				throw new Error(errorMessage);
			}
			throw new Error("An unexpected error occurred");
		}

		throw new Error("An unexpected error occurred");
	}
}

async function updateApplicationPromise(
	id: string,
	input: typeof updateApplicationInput.infer,
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	try {
		const baseUrl = await initApiBaseUrl();
		const result = await request(
			baseUrl,
			UpdateApplicationMutation,
			{ id, input },
			getRequestHeaders(accessToken),
		);
		return result;
	} catch (err) {
		if (err instanceof ClientError) {
			const graphqlErrors = err.response.errors;
			if (graphqlErrors?.length) {
				const error = graphqlErrors[0];
				const errorCode = error.extensions?.code;
				const errorMessage = errorCode
					? `${error.message} (${errorCode})`
					: error.message;
				throw new Error(errorMessage);
			}
			throw new Error("An unexpected error occurred");
		}

		throw new Error("An unexpected error occurred");
	}
}

async function getApplicationPromise(
	name: string,
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	const baseUrl = await initApiBaseUrl();
	const result = await request(
		baseUrl,
		ApplicationQuery,
		{ name },
		getRequestHeaders(accessToken),
	);
	return result;
}

async function getApplicationAndLatestReleasePromise(
	name: string,
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	const baseUrl = await initApiBaseUrl();
	const result = await request(
		baseUrl,
		ApplicationWithLatestReleaseQuery,
		{ name },
		getRequestHeaders(accessToken),
	);
	return result;
}

const actionInput = type({
	name: "string",
	url: "string",
});

export const subscriptionInput = type({
	name: "string",
	events: "string[]",
	url: "string",
});

export const releaseInput = type({
	applicationId: "string",
	version: "string",
	description: "string?",
	actions: actionInput.array().optional(),
	subscriptions: subscriptionInput.array().optional(),
});

async function createReleasePromise(
	input: typeof releaseInput.infer,
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	const inputParseResult = releaseInput(input);
	if (inputParseResult instanceof type.errors) {
		throw new Error(inputParseResult.summary);
	}

	// Default actions to empty array if undefined
	const releaseData = {
		...inputParseResult,
		actions: inputParseResult.actions ?? [],
	};

	try {
		const baseUrl = await initApiBaseUrl();
		const result = await request(
			baseUrl,
			CreateReleaseMutation,
			{ input: releaseData },
			getRequestHeaders(accessToken),
		);
		return result;
	} catch (err) {
		if (err instanceof ClientError) {
			const graphqlErrors = err.response.errors;
			if (graphqlErrors?.length) {
				const error = graphqlErrors[0];
				const errorCode = error.extensions?.code;
				const errorMessage = errorCode
					? `${error.message} (${errorCode})`
					: error.message;
				throw new Error(errorMessage);
			}
			throw new Error("An unexpected error occurred");
		}

		throw new Error("An unexpected error occurred");
	}
}

async function enableApplicationPromise(
	input: { applicationName: string; storeId: string },
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	try {
		const baseUrl = await initApiBaseUrl();
		const result = await request(
			baseUrl,
			EnableApplicationMutation,
			{ input },
			getRequestHeaders(accessToken),
		);
		return result;
	} catch (err) {
		if (err instanceof ClientError) {
			const graphqlErrors = err.response.errors;
			if (graphqlErrors?.length) {
				const error = graphqlErrors[0];
				const errorCode = error.extensions?.code;
				const errorMessage = errorCode
					? `${error.message} (${errorCode})`
					: error.message;
				throw new Error(errorMessage);
			}
			throw new Error("An unexpected error occurred");
		}

		throw new Error("An unexpected error occurred");
	}
}

async function disableApplicationPromise(
	input: { applicationName: string; storeId: string },
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	try {
		const baseUrl = await initApiBaseUrl();
		const result = await request(
			baseUrl,
			DisableApplicationMutation,
			{ input },
			getRequestHeaders(accessToken),
		);
		return result;
	} catch (err) {
		if (err instanceof ClientError) {
			const graphqlErrors = err.response.errors;
			if (graphqlErrors?.length) {
				const error = graphqlErrors[0];
				const errorCode = error.extensions?.code;
				const errorMessage = errorCode
					? `${error.message} (${errorCode})`
					: error.message;
				throw new Error(errorMessage);
			}
			throw new Error("An unexpected error occurred");
		}

		throw new Error("An unexpected error occurred");
	}
}

async function listApplicationsPromise({
	accessToken,
}: { accessToken: string | null }) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	const baseUrl = await initApiBaseUrl();
	const result = await request(
		baseUrl,
		ApplicationsListQuery,
		{},
		getRequestHeaders(accessToken),
	);
	return result;
}

async function archiveApplicationPromise(
	id: string,
	{ accessToken }: { accessToken: string | null },
) {
	if (!accessToken) {
		throw new Error("Access token is required");
	}

	try {
		const baseUrl = await initApiBaseUrl();
		const result = await request(
			baseUrl,
			ArchiveApplicationMutation,
			{ id },
			getRequestHeaders(accessToken),
		);
		return result;
	} catch (err) {
		if (err instanceof ClientError) {
			const graphqlErrors = err.response.errors;
			if (graphqlErrors?.length) {
				const error = graphqlErrors[0];
				const errorCode = error.extensions?.code;
				const errorMessage = errorCode
					? `${error.message} (${errorCode})`
					: error.message;
				throw new Error(errorMessage);
			}
			throw new Error("An unexpected error occurred");
		}

		throw new Error("An unexpected error occurred");
	}
}

export function createApplicationEffect(...args: Parameters<typeof createApplicationPromise>): Effect.Effect<Awaited<ReturnType<typeof createApplicationPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => createApplicationPromise(...args),
		catch: (error) => error,
	});
}

export function updateApplicationEffect(...args: Parameters<typeof updateApplicationPromise>): Effect.Effect<Awaited<ReturnType<typeof updateApplicationPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => updateApplicationPromise(...args),
		catch: (error) => error,
	});
}

export function getApplicationEffect(...args: Parameters<typeof getApplicationPromise>): Effect.Effect<Awaited<ReturnType<typeof getApplicationPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => getApplicationPromise(...args),
		catch: (error) => error,
	});
}

export function getApplicationAndLatestReleaseEffect(...args: Parameters<typeof getApplicationAndLatestReleasePromise>): Effect.Effect<Awaited<ReturnType<typeof getApplicationAndLatestReleasePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => getApplicationAndLatestReleasePromise(...args),
		catch: (error) => error,
	});
}

export function createReleaseEffect(...args: Parameters<typeof createReleasePromise>): Effect.Effect<Awaited<ReturnType<typeof createReleasePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => createReleasePromise(...args),
		catch: (error) => error,
	});
}

export function enableApplicationEffect(...args: Parameters<typeof enableApplicationPromise>): Effect.Effect<Awaited<ReturnType<typeof enableApplicationPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => enableApplicationPromise(...args),
		catch: (error) => error,
	});
}

export function disableApplicationEffect(...args: Parameters<typeof disableApplicationPromise>): Effect.Effect<Awaited<ReturnType<typeof disableApplicationPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => disableApplicationPromise(...args),
		catch: (error) => error,
	});
}

export function listApplicationsEffect(...args: Parameters<typeof listApplicationsPromise>): Effect.Effect<Awaited<ReturnType<typeof listApplicationsPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => listApplicationsPromise(...args),
		catch: (error) => error,
	});
}

export function archiveApplicationEffect(...args: Parameters<typeof archiveApplicationPromise>): Effect.Effect<Awaited<ReturnType<typeof archiveApplicationPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => archiveApplicationPromise(...args),
		catch: (error) => error,
	});
}

export function createApplication(
	...args: Parameters<typeof createApplicationPromise>
): Promise<Awaited<ReturnType<typeof createApplicationPromise>>> {
	return Effect.runPromise(createApplicationEffect(...args));
}

export function updateApplication(
	...args: Parameters<typeof updateApplicationPromise>
): Promise<Awaited<ReturnType<typeof updateApplicationPromise>>> {
	return Effect.runPromise(updateApplicationEffect(...args));
}

export function getApplication(
	...args: Parameters<typeof getApplicationPromise>
): Promise<Awaited<ReturnType<typeof getApplicationPromise>>> {
	return Effect.runPromise(getApplicationEffect(...args));
}

export function getApplicationAndLatestRelease(
	...args: Parameters<typeof getApplicationAndLatestReleasePromise>
): Promise<Awaited<ReturnType<typeof getApplicationAndLatestReleasePromise>>> {
	return Effect.runPromise(getApplicationAndLatestReleaseEffect(...args));
}

export function createRelease(
	...args: Parameters<typeof createReleasePromise>
): Promise<Awaited<ReturnType<typeof createReleasePromise>>> {
	return Effect.runPromise(createReleaseEffect(...args));
}

export function enableApplication(
	...args: Parameters<typeof enableApplicationPromise>
): Promise<Awaited<ReturnType<typeof enableApplicationPromise>>> {
	return Effect.runPromise(enableApplicationEffect(...args));
}

export function disableApplication(
	...args: Parameters<typeof disableApplicationPromise>
): Promise<Awaited<ReturnType<typeof disableApplicationPromise>>> {
	return Effect.runPromise(disableApplicationEffect(...args));
}

export function listApplications(
	...args: Parameters<typeof listApplicationsPromise>
): Promise<Awaited<ReturnType<typeof listApplicationsPromise>>> {
	return Effect.runPromise(listApplicationsEffect(...args));
}

export function archiveApplication(
	...args: Parameters<typeof archiveApplicationPromise>
): Promise<Awaited<ReturnType<typeof archiveApplicationPromise>>> {
	return Effect.runPromise(archiveApplicationEffect(...args));
}
