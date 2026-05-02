import { IExecuteFunctions, NodeOperationError } from 'n8n-workflow';
import RpcApi from 'atomicassets/build/API/Rpc';
import { toAttributeMap, AttributeMap, Format } from 'atomicassets/build/Actions/Generator';

export const ATOMIC_CONTRACT = 'atomicassets';

const ASSET_STRING_RE = /^\d+(?:\.\d+)?\s+[A-Z]{1,7}$/;

export function createAtomicRpc(endpoint: string, contract = ATOMIC_CONTRACT): RpcApi {
	return new RpcApi(endpoint, contract, { fetch: fetch as never });
}

export async function ensureAuthorized(
	context: IExecuteFunctions,
	rpc: RpcApi,
	collectionName: string,
	account: string,
): Promise<void> {
	let authorized: string[];
	try {
		const collection = await rpc.getCollection(collectionName);
		authorized = await collection.authorizedAccounts();
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			`Collection "${collectionName}" not found`,
		);
	}
	if (!authorized.includes(account)) {
		throw new NodeOperationError(
			context.getNode(),
			`Account "${account}" is not in authorized_accounts for collection "${collectionName}". The collection author must add it via atomicassets::addcolauth.`,
		);
	}
}

export async function fetchSchemaFormat(
	context: IExecuteFunctions,
	rpc: RpcApi,
	collectionName: string,
	schemaName: string,
): Promise<Format[]> {
	try {
		const schema = await rpc.getSchema(collectionName, schemaName);
		const raw = await schema.rawFormat();
		return raw.map((f) => ({ name: f.name, type: f.type }));
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'unknown error';
		throw new NodeOperationError(
			context.getNode(),
			`Schema "${schemaName}" not found in collection "${collectionName}" (${reason})`,
		);
	}
}

export async function ensureTemplateExists(
	context: IExecuteFunctions,
	rpc: RpcApi,
	collectionName: string,
	templateId: string,
): Promise<{ schema_name: string }> {
	try {
		const template = await rpc.getTemplate(collectionName, templateId);
		const data = await template.toObject() as { schema: { schema_name: string } | string };
		const schemaName = typeof data.schema === 'string' ? data.schema : data.schema.schema_name;
		return { schema_name: schemaName };
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			`Template "${templateId}" not found in collection "${collectionName}"`,
		);
	}
}

function parseJsonObject(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): Record<string, unknown> {
	if (raw === undefined || raw === null || raw === '') return {};
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') return {};
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new NodeOperationError(context.getNode(), `${field} must be valid JSON`);
		}
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new NodeOperationError(context.getNode(), `${field} must be a JSON object`);
		}
		return parsed as Record<string, unknown>;
	}
	throw new NodeOperationError(context.getNode(), `${field} must be a JSON object`);
}

export function buildAttributeMap(
	context: IExecuteFunctions,
	raw: unknown,
	format: Format[],
	field: string,
): AttributeMap {
	const plain = parseJsonObject(context, raw, field);
	if (Object.keys(plain).length === 0) return [];

	const formatNames = new Set(format.map((f) => f.name));
	for (const key of Object.keys(plain)) {
		if (!formatNames.has(key)) {
			throw new NodeOperationError(
				context.getNode(),
				`${field}: field "${key}" is not declared in the schema`,
			);
		}
	}

	try {
		return toAttributeMap(plain, format);
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'unknown error';
		throw new NodeOperationError(
			context.getNode(),
			`${field} could not be serialized against the schema: ${reason}`,
		);
	}
}

export function parseSchemaFormat(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): Format[] {
	if (raw === undefined || raw === null || raw === '') {
		throw new NodeOperationError(context.getNode(), `${field} is required`);
	}
	let parsed: unknown;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new NodeOperationError(context.getNode(), `${field} must be valid JSON`);
		}
	} else {
		parsed = raw;
	}
	if (!Array.isArray(parsed)) {
		throw new NodeOperationError(context.getNode(), `${field} must be a JSON array`);
	}
	const result: Format[] = [];
	for (const entry of parsed) {
		if (
			!entry ||
			typeof entry !== 'object' ||
			typeof (entry as Format).name !== 'string' ||
			typeof (entry as Format).type !== 'string'
		) {
			throw new NodeOperationError(
				context.getNode(),
				`${field} entries must be objects with string "name" and "type" fields`,
			);
		}
		result.push({ name: (entry as Format).name, type: (entry as Format).type });
	}
	return result;
}

export function parseTokensToBack(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string[] {
	if (raw === undefined || raw === null || raw === '') return [];
	if (typeof raw !== 'string') {
		throw new NodeOperationError(context.getNode(), `${field} must be a string`);
	}
	const items = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
	for (const item of items) {
		if (!ASSET_STRING_RE.test(item)) {
			throw new NodeOperationError(
				context.getNode(),
				`${field} entries must be EOSIO asset strings like "1.00000000 WAX"`,
			);
		}
	}
	return items;
}

export function requireTemplateId(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string {
	const node = context.getNode();
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		throw new NodeOperationError(node, `${field} must be a positive integer`);
	}
	if (n > 0x7fffffff) {
		throw new NodeOperationError(node, `${field} exceeds int32 maximum`);
	}
	return String(n);
}

export function requireMaxSupply(
	context: IExecuteFunctions,
	raw: unknown,
	field: string,
): string {
	const node = context.getNode();
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isInteger(n) || n < 0) {
		throw new NodeOperationError(node, `${field} must be a non-negative integer (0 = unlimited)`);
	}
	if (n > 0xffffffff) {
		throw new NodeOperationError(node, `${field} exceeds uint32 maximum`);
	}
	return String(n);
}
