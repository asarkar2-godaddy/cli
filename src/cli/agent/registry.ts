import type { NextAction } from "./types";

export const commandIds = {
	root: "root",
	authGroup: "auth.group",
	authLogin: "auth.login",
	authLogout: "auth.logout",
	authStatus: "auth.status",
	envGroup: "env.group",
	envList: "env.list",
	envGet: "env.get",
	envSet: "env.set",
	envInfo: "env.info",
	webhookGroup: "webhook.group",
	webhookEvents: "webhook.events",
	actionsGroup: "actions.group",
	actionsList: "actions.list",
	actionsDescribe: "actions.describe",
	applicationGroup: "application.group",
	applicationInfo: "application.info",
	applicationList: "application.list",
	applicationValidate: "application.validate",
	applicationUpdate: "application.update",
	applicationEnable: "application.enable",
	applicationDisable: "application.disable",
	applicationArchive: "application.archive",
	applicationInit: "application.init",
	applicationAddGroup: "application.add.group",
	applicationAddAction: "application.add.action",
	applicationAddSubscription: "application.add.subscription",
	applicationAddExtensionGroup: "application.add.extension.group",
	applicationAddExtensionEmbed: "application.add.extension.embed",
	applicationAddExtensionCheckout: "application.add.extension.checkout",
	applicationAddExtensionBlocks: "application.add.extension.blocks",
	applicationRelease: "application.release",
	applicationDeploy: "application.deploy",
} as const;

export type CommandId = (typeof commandIds)[keyof typeof commandIds];

export interface CommandRegistryNode {
	id: CommandId;
	command: string;
	description: string;
	usage: string;
	aliases?: string[];
	children?: CommandRegistryNode[];
}

const authNode: CommandRegistryNode = {
	id: commandIds.authGroup,
	command: "godaddy auth",
	description: "Manage authentication with GoDaddy Developer Platform",
	usage: "godaddy auth",
	children: [
		{
			id: commandIds.authLogin,
			command: "godaddy auth login",
			description: "Login to GoDaddy Developer Platform",
			usage: "godaddy auth login",
		},
		{
			id: commandIds.authLogout,
			command: "godaddy auth logout",
			description: "Logout and clear stored credentials",
			usage: "godaddy auth logout",
		},
		{
			id: commandIds.authStatus,
			command: "godaddy auth status",
			description: "Check authentication status",
			usage: "godaddy auth status",
		},
	],
};

const envNode: CommandRegistryNode = {
	id: commandIds.envGroup,
	command: "godaddy env",
	description: "Manage GoDaddy environments (ote, prod)",
	usage: "godaddy env",
	children: [
		{
			id: commandIds.envList,
			command: "godaddy env list",
			description: "List all available environments",
			usage: "godaddy env list",
		},
		{
			id: commandIds.envGet,
			command: "godaddy env get",
			description: "Get current active environment",
			usage: "godaddy env get",
		},
		{
			id: commandIds.envSet,
			command: "godaddy env set <environment>",
			description: "Set active environment",
			usage: "godaddy env set <environment>",
		},
		{
			id: commandIds.envInfo,
			command: "godaddy env info [environment]",
			description: "Show detailed information about an environment",
			usage: "godaddy env info [environment]",
		},
	],
};

const webhookNode: CommandRegistryNode = {
	id: commandIds.webhookGroup,
	command: "godaddy webhook",
	description: "Manage webhook integrations",
	usage: "godaddy webhook",
	children: [
		{
			id: commandIds.webhookEvents,
			command: "godaddy webhook events",
			description: "List available webhook event types",
			usage: "godaddy webhook events",
		},
	],
};

const actionsNode: CommandRegistryNode = {
	id: commandIds.actionsGroup,
	command: "godaddy actions",
	description: "Manage application actions",
	usage: "godaddy actions",
	children: [
		{
			id: commandIds.actionsList,
			command: "godaddy actions list",
			description:
				"List all available actions that an application developer can hook into",
			usage: "godaddy actions list",
		},
		{
			id: commandIds.actionsDescribe,
			command: "godaddy actions describe <action>",
			description:
				"Show detailed interface information for a specific action",
			usage: "godaddy actions describe <action>",
		},
	],
};

const applicationAddExtensionNode: CommandRegistryNode = {
	id: commandIds.applicationAddExtensionGroup,
	command: "godaddy application add extension",
	description: "Add UI extension configuration to godaddy.toml",
	usage: "godaddy application add extension",
	children: [
		{
			id: commandIds.applicationAddExtensionEmbed,
			command:
				"godaddy application add extension embed --name <name> --handle <handle> --source <source> --target <targets>",
			description: "Add an embed extension",
			usage:
				"godaddy application add extension embed --name <name> --handle <handle> --source <source> --target <targets>",
		},
		{
			id: commandIds.applicationAddExtensionCheckout,
			command:
				"godaddy application add extension checkout --name <name> --handle <handle> --source <source> --target <targets>",
			description: "Add a checkout extension",
			usage:
				"godaddy application add extension checkout --name <name> --handle <handle> --source <source> --target <targets>",
		},
		{
			id: commandIds.applicationAddExtensionBlocks,
			command:
				"godaddy application add extension blocks --source <source>",
			description: "Set the blocks extension source",
			usage:
				"godaddy application add extension blocks --source <source>",
		},
	],
};

const applicationAddNode: CommandRegistryNode = {
	id: commandIds.applicationAddGroup,
	command: "godaddy application add",
	description: "Add configurations to application",
	usage: "godaddy application add",
	children: [
		{
			id: commandIds.applicationAddAction,
			command: "godaddy application add action --name <name> --url <url>",
			description: "Add action configuration to godaddy.toml",
			usage: "godaddy application add action --name <name> --url <url>",
		},
		{
			id: commandIds.applicationAddSubscription,
			command:
				"godaddy application add subscription --name <name> --events <events> --url <url>",
			description: "Add webhook subscription configuration to godaddy.toml",
			usage:
				"godaddy application add subscription --name <name> --events <events> --url <url>",
		},
		applicationAddExtensionNode,
	],
};

const applicationNode: CommandRegistryNode = {
	id: commandIds.applicationGroup,
	command: "godaddy application",
	description: "Manage applications",
	usage: "godaddy application",
	aliases: ["godaddy app"],
	children: [
		{
			id: commandIds.applicationInfo,
			command: "godaddy application info <name>",
			description: "Show application information",
			usage: "godaddy application info <name>",
		},
		{
			id: commandIds.applicationList,
			command: "godaddy application list",
			description: "List all applications",
			usage: "godaddy application list",
			aliases: ["godaddy app ls"],
		},
		{
			id: commandIds.applicationValidate,
			command: "godaddy application validate <name>",
			description: "Validate application configuration",
			usage: "godaddy application validate <name>",
		},
		{
			id: commandIds.applicationUpdate,
			command:
				"godaddy application update <name> [--label <label>] [--description <description>] [--status <status>]",
			description: "Update application configuration",
			usage:
				"godaddy application update <name> [--label <label>] [--description <description>] [--status <status>]",
		},
		{
			id: commandIds.applicationEnable,
			command:
				"godaddy application enable <name> --store-id <storeId>",
			description: "Enable application on a store",
			usage:
				"godaddy application enable <name> --store-id <storeId>",
		},
		{
			id: commandIds.applicationDisable,
			command:
				"godaddy application disable <name> --store-id <storeId>",
			description: "Disable application on a store",
			usage:
				"godaddy application disable <name> --store-id <storeId>",
		},
		{
			id: commandIds.applicationArchive,
			command: "godaddy application archive <name>",
			description: "Archive application",
			usage: "godaddy application archive <name>",
		},
		{
			id: commandIds.applicationInit,
			command:
				"godaddy application init [--name <name>] [--description <description>] [--url <url>] [--proxy-url <proxyUrl>] [--scopes <scopes>] [--config <path>] [--environment <env>]",
			description: "Initialize/create a new application",
			usage:
				"godaddy application init [--name <name>] [--description <description>] [--url <url>] [--proxy-url <proxyUrl>] [--scopes <scopes>] [--config <path>] [--environment <env>]",
		},
		applicationAddNode,
		{
			id: commandIds.applicationRelease,
			command:
				"godaddy application release <name> --release-version <version> [--description <description>] [--config <path>] [--environment <env>]",
			description: "Create a new release for the application",
			usage:
				"godaddy application release <name> --release-version <version> [--description <description>] [--config <path>] [--environment <env>]",
		},
		{
			id: commandIds.applicationDeploy,
			command:
				"godaddy application deploy <name> [--config <path>] [--environment <env>]",
			description: "Deploy application (change status to ACTIVE)",
			usage:
				"godaddy application deploy <name> [--config <path>] [--environment <env>]",
		},
	],
};

export const commandRegistry: CommandRegistryNode = {
	id: commandIds.root,
	command: "godaddy",
	description:
		"GoDaddy Developer Platform CLI - Agent-first JSON command interface",
	usage: "godaddy",
	children: [authNode, envNode, webhookNode, actionsNode, applicationNode],
};

function cloneNode(node: CommandRegistryNode): CommandRegistryNode {
	return {
		...node,
		children: node.children?.map(cloneNode),
	};
}

export function getRootCommandTree(): CommandRegistryNode {
	return cloneNode(commandRegistry);
}

export function findRegistryNodeById(
	id: CommandId,
	node: CommandRegistryNode = commandRegistry,
): CommandRegistryNode | undefined {
	if (node.id === id) {
		return node;
	}

	for (const child of node.children ?? []) {
		const match = findRegistryNodeById(id, child);
		if (match) {
			return match;
		}
	}

	return undefined;
}

export function registryNodeToResult(node: CommandRegistryNode): {
	id: CommandId;
	command: string;
	description: string;
	usage: string;
	aliases?: string[];
	commands?: Array<{
		id: CommandId;
		command: string;
		description: string;
		usage: string;
		aliases?: string[];
	}>;
} {
	return {
		id: node.id,
		command: node.command,
		description: node.description,
		usage: node.usage,
		aliases: node.aliases,
		commands: node.children?.map((child) => ({
			id: child.id,
			command: child.command,
			description: child.description,
			usage: child.usage,
			aliases: child.aliases,
		})),
	};
}

export const registryCoverage: Record<CommandId, true> = {
	[commandIds.root]: true,
	[commandIds.authGroup]: true,
	[commandIds.authLogin]: true,
	[commandIds.authLogout]: true,
	[commandIds.authStatus]: true,
	[commandIds.envGroup]: true,
	[commandIds.envList]: true,
	[commandIds.envGet]: true,
	[commandIds.envSet]: true,
	[commandIds.envInfo]: true,
	[commandIds.webhookGroup]: true,
	[commandIds.webhookEvents]: true,
	[commandIds.actionsGroup]: true,
	[commandIds.actionsList]: true,
	[commandIds.actionsDescribe]: true,
	[commandIds.applicationGroup]: true,
	[commandIds.applicationInfo]: true,
	[commandIds.applicationList]: true,
	[commandIds.applicationValidate]: true,
	[commandIds.applicationUpdate]: true,
	[commandIds.applicationEnable]: true,
	[commandIds.applicationDisable]: true,
	[commandIds.applicationArchive]: true,
	[commandIds.applicationInit]: true,
	[commandIds.applicationAddGroup]: true,
	[commandIds.applicationAddAction]: true,
	[commandIds.applicationAddSubscription]: true,
	[commandIds.applicationAddExtensionGroup]: true,
	[commandIds.applicationAddExtensionEmbed]: true,
	[commandIds.applicationAddExtensionCheckout]: true,
	[commandIds.applicationAddExtensionBlocks]: true,
	[commandIds.applicationRelease]: true,
	[commandIds.applicationDeploy]: true,
};

export function flattenRegistry(
	node: CommandRegistryNode = commandRegistry,
	acc: CommandRegistryNode[] = [],
): CommandRegistryNode[] {
	acc.push(node);
	for (const child of node.children ?? []) {
		flattenRegistry(child, acc);
	}
	return acc;
}

export function defaultRootNextActions(): NextAction[] {
	return [
		{
			command: "godaddy auth status",
			description: "Check authentication status",
		},
		{
			command: "godaddy env get",
			description: "Get current active environment",
		},
		{
			command: "godaddy application list",
			description: "List all applications",
		},
	];
}
