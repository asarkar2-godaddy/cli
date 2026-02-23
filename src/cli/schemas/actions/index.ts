import * as fs from "node:fs";
import * as path from "node:path";

export interface ActionInterface {
	name: string;
	description: string;
	requestSchema: object;
	responseSchema: object;
	examples?: {
		request: object;
		response: object;
	};
}

const SCHEMAS_DIR = path.dirname(new URL(import.meta.url).pathname);

let _manifest: Record<string, string> | undefined;

function loadManifest(): Record<string, string> {
	if (!_manifest) {
		const raw = fs.readFileSync(
			path.join(SCHEMAS_DIR, "manifest.json"),
			"utf-8",
		);
		_manifest = JSON.parse(raw) as Record<string, string>;
	}
	return _manifest;
}

/**
 * List all available action names.
 */
export function listActionNames(): string[] {
	return Object.keys(loadManifest());
}

/**
 * Load a single action interface by name.
 * Returns undefined if the action is not found.
 */
export function loadActionInterface(
	name: string,
): ActionInterface | undefined {
	const manifest = loadManifest();
	const filename = manifest[name];
	if (!filename) {
		return undefined;
	}
	const raw = fs.readFileSync(path.join(SCHEMAS_DIR, filename), "utf-8");
	return JSON.parse(raw) as ActionInterface;
}

/**
 * Load all action interfaces.
 */
export function loadAllActionInterfaces(): Record<string, ActionInterface> {
	const manifest = loadManifest();
	const result: Record<string, ActionInterface> = {};
	for (const [name, filename] of Object.entries(manifest)) {
		const raw = fs.readFileSync(path.join(SCHEMAS_DIR, filename), "utf-8");
		result[name] = JSON.parse(raw) as ActionInterface;
	}
	return result;
}

/**
 * The full list of available actions (including those without detailed schemas).
 */
export const AVAILABLE_ACTIONS = [
	"location.address.verify",
	"commerce.taxes.calculate",
	"commerce.shipping-rates.calculate",
	"commerce.price-adjustment.apply",
	"commerce.price-adjustment.list",
	"notifications.email.send",
	"commerce.payment.get",
	"commerce.payment.cancel",
	"commerce.payment.refund",
	"commerce.payment.process",
	"commerce.payment.auth",
];
