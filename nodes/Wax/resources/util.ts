import { IExecuteFunctions, NodeOperationError } from 'n8n-workflow';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';

export const CHAIN_IDS: Record<string, string> = {
	mainnet: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4',
	testnet: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12',
};

/**
 * Refuse to sign if the endpoint is not the chain the credential was issued for.
 *
 * The endpoint is a free-text field and credentials carry no inherent chain, so
 * without this a workflow believed to be pointed at testnet will happily sign
 * against mainnet. Read-only calls are unaffected; this guards the signing paths.
 */
// Verified (endpoint, chain) pairs, so a batch of N items costs one get_info
// rather than N. Process-lifetime; chain IDs do not change.
const verifiedChains = new Set<string>();

/**
 * Resolve the chain ID a credential requires, or null when unguarded.
 * Signing paths pin this into eosjs so the endpoint's own answer is never trusted.
 */
export function expectedChainIdFor(credentials: { network?: unknown; expectedChainId?: unknown }): string | null {
	const network = typeof credentials.network === 'string' ? credentials.network : 'unset';
	if (network === 'unset') return null;
	if (network === 'custom') {
		const custom = (typeof credentials.expectedChainId === 'string' ? credentials.expectedChainId : '')
			.trim()
			.toLowerCase();
		return /^[0-9a-f]{64}$/.test(custom) ? custom : null;
	}
	return CHAIN_IDS[network] || null;
}

/** Reject a finite-but-invalid byte count before it reaches the chain. */
export function requireByteCount(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
	minimum = 128,
): number {
	const value = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(value)) {
		throw new NodeOperationError(context.getNode(), `${field} must be a number`);
	}
	const bytes = Math.floor(value);
	if (bytes < minimum) {
		throw new NodeOperationError(context.getNode(), `${field} must be at least ${minimum} bytes`);
	}
	return bytes;
}

/** Reject NaN/Infinity/negative WAX amounts that would otherwise fail silently. */
export function requireNonNegativeAmount(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): number {
	const value = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(value) || value < 0) {
		throw new NodeOperationError(context.getNode(), `${field} must be a non-negative number`);
	}
	return value;
}

export async function assertChainId(
	context: IExecuteFunctions,
	endpoint: string,
	credentials: { network?: unknown; expectedChainId?: unknown },
): Promise<void> {
	const network = typeof credentials.network === 'string' ? credentials.network : 'unset';

	// Credentials saved before this field existed are handed to us with the
	// field's default applied, so 'unset' must be that default for upgrading the
	// package to leave existing workflows alone. Warsaken's own credentials set
	// this explicitly.
	if (network === 'unset') return;

	let expected: string;
	if (network === 'custom') {
		const custom = (typeof credentials.expectedChainId === 'string' ? credentials.expectedChainId : '')
			.trim()
			.toLowerCase();
		// A custom chain with no expected ID is an explicit opt-out.
		if (!custom) return;
		if (!/^[0-9a-f]{64}$/.test(custom)) {
			throw new NodeOperationError(
				context.getNode(),
				'Expected Chain ID must be 64 hexadecimal characters',
			);
		}
		expected = custom;
	} else {
		expected = CHAIN_IDS[network];
		// An unrecognised network must fail closed: this guard exists to stop a
		// mainnet accident, so it must never silently skip.
		if (!expected) {
			throw new NodeOperationError(
				context.getNode(),
				`Unknown network "${network}" on the credential. Expected one of: ${Object.keys(CHAIN_IDS).join(', ')}, custom, unset.`,
			);
		}
	}

	const cacheKey = `${endpoint}|${expected}`;
	if (verifiedChains.has(cacheKey)) return;

	let actual: string;
	try {
		const res = await fetch(buildUrl(endpoint, '/v1/chain/get_info'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const info = (await res.json()) as { chain_id?: string };
		if (typeof info.chain_id !== 'string' || !info.chain_id) {
			throw new Error('response contained no chain_id');
		}
		actual = info.chain_id.toLowerCase();
	} catch (error) {
		throw new NodeOperationError(
			context.getNode(),
			`Could not read chain ID from ${endpoint} to verify the network: ${redactSensitive(String(error))}`,
		);
	}

	if (actual === expected) {
		verifiedChains.add(cacheKey);
		return;
	}

	{
		const label = (id: string) =>
			Object.keys(CHAIN_IDS).find((k) => CHAIN_IDS[k] === id) || `chain ${id.slice(0, 12)}...`;
		throw new NodeOperationError(
			context.getNode(),
			`Credential is for ${network === 'custom' ? label(expected) : `WAX ${network}`}, but ${endpoint} is ${label(actual)}. Refusing to sign. Fix the API Endpoint or the credential's Network.`,
		);
	}
}

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

	return url.toString().replace(/\/+$/, '');
}

export function buildUrl(endpoint: string, path: string): string {
	const base = new URL(endpoint);
	const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
	const rel = path.startsWith('/') ? path.slice(1) : path;
	return new URL(basePath + rel, base).toString();
}

export const MAX_PAGINATION_ITERATIONS = 5000;

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
	// Antelope name encoding treats '.' as symbol value 0, so leading dots are
	// valid (e.g. WAX Cloud Wallet names like ".lgbs.wam"). Only an all-dot
	// string is meaningless - it encodes to the null/empty name.
	if (!/[a-z1-5]/.test(name)) {
		throw new NodeOperationError(node, `${field} must contain at least one letter or digit`);
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

const REDACT_PATTERNS: RegExp[] = [
	/\b5[1-9A-HJ-NP-Za-km-z]{50}\b/g,
	/\bPVT_[A-Z0-9]+_[1-9A-HJ-NP-Za-km-z]+/g,
	/\bEOS[1-9A-HJ-NP-Za-km-z]{50}\b/g,
	/\bPUB_[A-Z0-9]+_[1-9A-HJ-NP-Za-km-z]+/g,
	/\bSIG_[A-Z0-9]+_[1-9A-HJ-NP-Za-km-z]+/g,
	/\b[a-f0-9]{64,}\b/gi,
];

export function redactSensitive(input: string): string {
	let out = input;
	for (const re of REDACT_PATTERNS) {
		out = out.replace(re, '[REDACTED]');
	}
	return out;
}

export function safeError(error: unknown): { message: string } {
	if (error instanceof Error) {
		return { message: redactSensitive(error.message) };
	}
	if (typeof error === 'string') {
		return { message: redactSensitive(error) };
	}
	return { message: 'Unknown error' };
}

/**
 * The only supported way to build a transaction signer.
 *
 * Verifies the endpoint really is the chain the credential declares, then pins
 * that chain ID into eosjs so the endpoint's own `get_info` is never trusted.
 * Routing every signing path through here is deliberate: a new operation cannot
 * sign without the guard, because it cannot get an Api any other way.
 */
export async function createSigningApi(
	context: IExecuteFunctions,
	endpoint: string,
	credentials: { network?: unknown; expectedChainId?: unknown; privateKey?: unknown },
): Promise<Api> {
	await assertChainId(context, endpoint, credentials);

	const key = typeof credentials.privateKey === 'string' ? credentials.privateKey.trim() : '';
	if (!key) {
		throw new NodeOperationError(context.getNode(), 'Credential is missing a private key');
	}

	const signatureProvider = new JsSignatureProvider([key]);
	const rpc = new JsonRpc(endpoint, { fetch });

	return new Api({
		rpc,
		signatureProvider,
		chainId: expectedChainIdFor(credentials) ?? undefined,
		textDecoder: new TextDecoder(),
		textEncoder: new TextEncoder(),
	});
}
