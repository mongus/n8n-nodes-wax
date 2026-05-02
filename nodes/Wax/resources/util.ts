import { IExecuteFunctions, NodeOperationError } from 'n8n-workflow';

export async function getCredentials(context: IExecuteFunctions, errorMessage?: string) {
	try {
		return await context.getCredentials('waxPrivateKeyApi');
	}
	catch (error) {
		throw new NodeOperationError(context.getNode(), errorMessage || `Credentials required for this operation.`);
	}
}

const BLOCKED_HOSTS = new Set([
	'metadata.google.internal',
	'metadata',
	'metadata.aws',
	'instance-data',
	'localhost',
]);

function stripIpv6Brackets(host: string): string {
	return host.replace(/^\[|\]$/g, '');
}

function isBareIp(host: string): boolean {
	const h = stripIpv6Brackets(host);
	if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
	if (/^0x[\da-f.]+$/i.test(h)) return true;
	if (/^\d{8,}$/.test(h)) return true;
	if (h.includes(':') && /^[\da-f:%.]+$/i.test(h)) return true;
	return false;
}

export interface ValidateEndpointOptions {
	signing?: boolean;
}

export function validateEndpoint(
	context: IExecuteFunctions,
	raw: string,
	options: ValidateEndpointOptions = {},
): string {
	const node = context.getNode();
	if (!raw || typeof raw !== 'string') {
		throw new NodeOperationError(node, 'API Endpoint is required');
	}

	const trimmed = raw.trim();
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new NodeOperationError(node, `Invalid API Endpoint URL`);
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new NodeOperationError(node, `API Endpoint must use http or https`);
	}

	if (options.signing && url.protocol !== 'https:') {
		throw new NodeOperationError(node, 'API Endpoint must use https for signing operations');
	}

	if (url.username || url.password) {
		throw new NodeOperationError(node, 'API Endpoint must not embed credentials');
	}

	const host = url.hostname.toLowerCase();
	if (!host) {
		throw new NodeOperationError(node, 'API Endpoint must include a host');
	}

	if (BLOCKED_HOSTS.has(host)) {
		throw new NodeOperationError(node, `API Endpoint host not allowed`);
	}

	if (isBareIp(host)) {
		throw new NodeOperationError(node, `API Endpoint must use a hostname, not an IP address`);
	}

	return url.toString();
}

export function buildUrl(endpoint: string, path: string): string {
	const base = new URL(endpoint);
	const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
	const rel = path.startsWith('/') ? path.slice(1) : path;
	return new URL(basePath + rel, base).toString();
}
