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

const ACCOUNT_NAME_RE = /^[a-z1-5.]+$/;
const SYMBOL_RE = /^[A-Z]{1,7}$/;
const ASSET_ID_RE = /^\d+$/;
const MEMO_MAX_BYTES = 256;

export function requireAccountName(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string {
	const node = context.getNode();
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new NodeOperationError(node, `${field} is required`);
	}
	const name = raw.trim().toLowerCase();
	if (name.length > 13) {
		throw new NodeOperationError(node, `${field} must be at most 13 characters`);
	}
	if (!ACCOUNT_NAME_RE.test(name)) {
		throw new NodeOperationError(
			node,
			`${field} must contain only lowercase letters a-z, digits 1-5, and dots`,
		);
	}
	if (name.startsWith('.') || name.endsWith('.')) {
		throw new NodeOperationError(node, `${field} must not start or end with a dot`);
	}
	return name;
}

export function requireAmount(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): number {
	const node = context.getNode();
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(n)) {
		throw new NodeOperationError(node, `${field} must be a finite number`);
	}
	if (n <= 0) {
		throw new NodeOperationError(node, `${field} must be greater than zero`);
	}
	return n;
}

export function requirePrecision(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
	fallback = 8,
): number {
	const node = context.getNode();
	if (raw === undefined || raw === null || raw === '') return fallback;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isInteger(n) || n < 0 || n > 18) {
		throw new NodeOperationError(node, `${field} must be an integer between 0 and 18`);
	}
	return n;
}

export function requireSymbol(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string {
	const node = context.getNode();
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new NodeOperationError(node, `${field} is required`);
	}
	const sym = raw.trim().toUpperCase();
	if (!SYMBOL_RE.test(sym)) {
		throw new NodeOperationError(node, `${field} must be 1-7 uppercase letters`);
	}
	return sym;
}

export function requireAssetIds(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string[] {
	const node = context.getNode();
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new NodeOperationError(node, `${field} is required`);
	}
	const ids = raw.split(',').map((id) => id.trim()).filter((id) => id !== '');
	if (ids.length === 0) {
		throw new NodeOperationError(node, `${field} must contain at least one ID`);
	}
	for (const id of ids) {
		if (!ASSET_ID_RE.test(id)) {
			throw new NodeOperationError(node, `${field} must be a comma-separated list of numeric IDs`);
		}
	}
	return ids;
}

export function normalizeMemo(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string {
	const node = context.getNode();
	const memo = typeof raw === 'string' ? raw : '';
	if (Buffer.byteLength(memo, 'utf8') > MEMO_MAX_BYTES) {
		throw new NodeOperationError(node, `${field} must be ${MEMO_MAX_BYTES} bytes or fewer`);
	}
	return memo;
}
