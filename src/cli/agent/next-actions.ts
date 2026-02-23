import { commandIds, type CommandId } from "./registry";
import type { NextAction } from "./types";

export interface NextActionContext {
	authenticated?: boolean;
	applicationName?: string;
	environment?: string;
	storeId?: string;
	actionName?: string;
}

export function nextActionsFor(
	commandId: CommandId,
	context: NextActionContext = {},
): NextAction[] {
	switch (commandId) {
		case commandIds.root:
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
		case commandIds.authGroup:
			return [
				{ command: "godaddy auth login", description: "Login" },
				{ command: "godaddy auth status", description: "Check auth status" },
			];
		case commandIds.authLogin:
			return [
				{
					command: "godaddy auth status",
					description: "Verify current authentication status",
				},
				{
					command: "godaddy application list",
					description: "List applications for the active account",
				},
				{ command: "godaddy auth logout", description: "Logout" },
			];
		case commandIds.authLogout:
			return [
				{ command: "godaddy auth login", description: "Authenticate again" },
				{ command: "godaddy auth status", description: "Check auth status" },
			];
		case commandIds.authStatus:
			if (!context.authenticated) {
				return [
					{
						command: "godaddy auth login",
						description: "Authenticate with GoDaddy",
					},
					{
						command: "godaddy env get",
						description: "Check the active environment",
					},
				];
			}

			return [
				{
					command: "godaddy application list",
					description: "List applications",
				},
				{
					command: "godaddy env get",
					description: "Check active environment",
				},
			];
		case commandIds.envGroup:
			return [
				{ command: "godaddy env get", description: "Get active environment" },
				{ command: "godaddy env list", description: "List environments" },
				{
					command: "godaddy env set <environment>",
					description: "Set active environment",
					params: {
						environment: {
							description: "Environment name",
							enum: ["ote", "prod"],
							default: "ote",
							required: true,
						},
					},
				},
			];
		case commandIds.envList:
			return [
				{ command: "godaddy env get", description: "Get active environment" },
				{
					command: "godaddy env set <environment>",
					description: "Set active environment",
					params: {
						environment: {
							enum: ["ote", "prod"],
							default: "ote",
							required: true,
						},
					},
				},
				{
					command: "godaddy env info [environment]",
					description: "Show environment details",
					params: {
						environment: { enum: ["ote", "prod"], default: "ote" },
					},
				},
			];
		case commandIds.envGet:
			return [
				{
					command: "godaddy env set <environment>",
					description: "Set active environment",
					params: {
						environment: { enum: ["ote", "prod"], required: true },
					},
				},
				{
					command: "godaddy env info [environment]",
					description: "Show environment details",
					params: {
						environment: { enum: ["ote", "prod"], default: "ote" },
					},
				},
			];
		case commandIds.envSet:
			return [
				{ command: "godaddy env get", description: "Get active environment" },
				{
					command: "godaddy auth status",
					description: "Check auth for active environment",
				},
			];
		case commandIds.envInfo:
			return [
				{
					command: "godaddy env set <environment>",
					description: "Set active environment",
					params: {
						environment: {
							enum: ["ote", "prod"],
							value: context.environment ?? "ote",
							required: true,
						},
					},
				},
				{ command: "godaddy auth status", description: "Check auth status" },
			];
		case commandIds.webhookGroup:
			return [
				{
					command: "godaddy webhook events",
					description: "List available webhook events",
				},
			];
		case commandIds.webhookEvents:
			return [
				{
					command:
						"godaddy application add subscription --name <name> --events <events> --url <url>",
					description: "Add a webhook subscription to config",
					params: {
						name: { description: "Subscription name", required: true },
						events: {
							description: "Comma-separated event list",
							required: true,
						},
						url: { description: "Webhook endpoint", required: true },
					},
				},
				{ command: "godaddy webhook events", description: "Refresh event list" },
			];
		case commandIds.actionsGroup:
			return [
				{ command: "godaddy actions list", description: "List all actions" },
				{
					command: "godaddy actions describe <action>",
					description: "Describe an action contract",
					params: {
						action: { description: "Action name", required: true },
					},
				},
			];
		case commandIds.actionsList:
			return [
				{
					command: "godaddy actions describe <action>",
					description: "Describe an action contract",
					params: {
						action: {
							description: "Action name",
							value: context.actionName ?? "location.address.verify",
							required: true,
						},
					},
				},
				{
					command:
						"godaddy application add action --name <name> --url <url>",
					description: "Add action configuration",
					params: {
						name: { required: true },
						url: { required: true },
					},
				},
			];
		case commandIds.actionsDescribe:
			return [
				{ command: "godaddy actions list", description: "List all actions" },
				{
					command:
						"godaddy application add action --name <name> --url <url>",
					description: "Add action configuration",
					params: {
						name: {
							description: "Action name",
							value: context.actionName ?? "",
							required: true,
						},
						url: { required: true },
					},
				},
			];
		case commandIds.applicationGroup:
			return [
				{
					command: "godaddy application list",
					description: "List all applications",
				},
				{
					command:
						"godaddy application init --name <name> --description <description> --url <url> --proxy-url <proxyUrl> --scopes <scopes>",
					description: "Initialize a new application",
				},
				{
					command:
						"godaddy application add action --name <name> --url <url>",
					description: "Add action configuration",
				},
			];
		case commandIds.applicationInfo:
			return [
				{
					command: "godaddy application validate <name>",
					description: "Validate application configuration",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
				{
					command:
						"godaddy application update <name> [--label <label>] [--description <description>] [--status <status>]",
					description: "Update application configuration",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						status: { enum: ["ACTIVE", "INACTIVE"] },
					},
				},
				{
					command:
						"godaddy application release <name> --release-version <version>",
					description: "Create a release",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						version: { required: true },
					},
				},
			];
		case commandIds.applicationList:
			return [
				{
					command: "godaddy application info <name>",
					description: "Get details for a specific application",
					params: { name: { required: true } },
				},
				{
					command:
						"godaddy application init --name <name> --description <description> --url <url> --proxy-url <proxyUrl> --scopes <scopes>",
					description: "Initialize a new application",
				},
			];
		case commandIds.applicationValidate:
			return [
				{
					command:
						"godaddy application release <name> --release-version <version>",
					description: "Create a release after validation",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						version: { required: true },
					},
				},
				{
					command: "godaddy application info <name>",
					description: "Inspect application details",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
			];
		case commandIds.applicationUpdate:
			return [
				{
					command: "godaddy application info <name>",
					description: "Inspect updated application",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
				{
					command: "godaddy application deploy <name>",
					description: "Deploy updated application",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
			];
		case commandIds.applicationEnable:
			return [
				{
					command:
						"godaddy application disable <name> --store-id <storeId>",
					description: "Disable the application on the same store",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						storeId: {
							value: context.storeId ?? "",
							required: true,
						},
					},
				},
				{
					command: "godaddy application info <name>",
					description: "Inspect application status",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
			];
		case commandIds.applicationDisable:
			return [
				{
					command:
						"godaddy application enable <name> --store-id <storeId>",
					description: "Re-enable the application on the same store",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						storeId: {
							value: context.storeId ?? "",
							required: true,
						},
					},
				},
				{
					command: "godaddy application info <name>",
					description: "Inspect application status",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
			];
		case commandIds.applicationArchive:
			return [
				{
					command: "godaddy application info <name>",
					description: "Inspect archived application",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
				{
					command: "godaddy application list",
					description: "List all applications",
				},
			];
		case commandIds.applicationInit:
			return [
				{
					command:
						"godaddy application add action --name <name> --url <url>",
					description: "Add first action",
				},
				{
					command:
						"godaddy application add subscription --name <name> --events <events> --url <url>",
					description: "Add webhook subscription",
				},
				{
					command:
						"godaddy application release <name> --release-version <version>",
					description: "Create first release",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						version: { required: true },
					},
				},
			];
		case commandIds.applicationAddGroup:
			return [
				{
					command:
						"godaddy application add action --name <name> --url <url>",
					description: "Add action configuration",
				},
				{
					command:
						"godaddy application add subscription --name <name> --events <events> --url <url>",
					description: "Add webhook subscription",
				},
				{
					command: "godaddy application add extension",
					description: "Show extension add commands",
				},
			];
		case commandIds.applicationAddAction:
		case commandIds.applicationAddSubscription:
		case commandIds.applicationAddExtensionEmbed:
		case commandIds.applicationAddExtensionCheckout:
		case commandIds.applicationAddExtensionBlocks:
			return [
				{
					command: "godaddy application validate <name>",
					description: "Validate application configuration",
					params: { name: { required: true } },
				},
				{
					command:
						"godaddy application release <name> --release-version <version>",
					description: "Create a new release",
					params: {
						name: { required: true },
						version: { required: true },
					},
				},
			];
		case commandIds.applicationAddExtensionGroup:
			return [
				{
					command:
						"godaddy application add extension embed --name <name> --handle <handle> --source <source> --target <targets>",
					description: "Add embed extension",
				},
				{
					command:
						"godaddy application add extension checkout --name <name> --handle <handle> --source <source> --target <targets>",
					description: "Add checkout extension",
				},
				{
					command:
						"godaddy application add extension blocks --source <source>",
					description: "Configure blocks extension",
				},
			];
		case commandIds.applicationRelease:
			return [
				{
					command: "godaddy application deploy <name>",
					description: "Deploy the released application",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
				{
					command: "godaddy application info <name>",
					description: "Inspect application and latest release",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
			];
		case commandIds.applicationDeploy:
			return [
				{
					command:
						"godaddy application enable <name> --store-id <storeId>",
					description: "Enable the application on a store",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
						storeId: { required: true },
					},
				},
				{
					command: "godaddy application info <name>",
					description: "Inspect deployment status",
					params: {
						name: {
							value: context.applicationName ?? "",
							required: true,
						},
					},
				},
			];
		default:
			return [
				{ command: "godaddy", description: "Show command tree" },
				{ command: "godaddy --help", description: "Show CLI help" },
			];
	}
}
