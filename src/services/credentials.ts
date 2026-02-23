import * as fs from "node:fs";
import * as Effect from "effect/Effect";
import { homedir } from "node:os";
import { join } from "node:path";

type Credentials = {
	CLIENT_ID: string;
	CLIENT_SECRET: string;
};

const PATH = join(homedir(), ".godaddy", "credentials");

async function getCredentialsPromise(): Promise<Credentials> {
	let text = "";
	try {
		if (fs.existsSync(PATH)) {
			text = fs.readFileSync(PATH, "utf-8");
		} else {
			return {
				CLIENT_ID: "",
				CLIENT_SECRET: "",
			};
		}
	} catch (error: unknown) {
		// Handle potential read errors
		const errorMessage =
			error instanceof Error ? error.message : "An unknown error occurred";
		console.error(`Error reading credentials file at ${PATH}: ${errorMessage}`);
		return {
			CLIENT_ID: "",
			CLIENT_SECRET: "",
		};
	}

	let CLIENT_ID = "";
	let CLIENT_SECRET = "";

	const lines = text.split("\n").filter(Boolean);
	for (const line of lines) {
		const [key, value] = line.split("=");

		if (key === "client_id") {
			CLIENT_ID = value;
		} else if (key === "client_secret") {
			CLIENT_SECRET = value;
		}
	}

	return {
		CLIENT_ID,
		CLIENT_SECRET,
	};
}

export function getCredentialsEffect(...args: Parameters<typeof getCredentialsPromise>): Effect.Effect<Awaited<ReturnType<typeof getCredentialsPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => getCredentialsPromise(...args),
		catch: (error) => error,
	});
}

export function getCredentials(
	...args: Parameters<typeof getCredentialsPromise>
): Promise<Awaited<ReturnType<typeof getCredentialsPromise>>> {
	return Effect.runPromise(getCredentialsEffect(...args));
}
