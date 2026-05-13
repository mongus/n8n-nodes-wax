import { IExecuteFunctions, INodeExecutionData, INodeProperties, NodeOperationError } from 'n8n-workflow';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';
import {
	getCredentials,
	MAX_PAGINATION_ITERATIONS,
	normalizeMemo,
	requireAccountName,
	requireAssetIds,
	validateEndpoint,
} from './util';
import {
	buildAttributeMap,
	createActionGenerator,
	createAtomicRpc,
	ensureAuthorized,
	ensureTemplateExists,
	fetchSchemaFormat,
	parseTokensToBack,
	requireTemplateId,
} from './atomic';
import { WaxJS } from '@waxio/waxjs/dist';
import { WaxAsset } from './common';

// Asset resource properties
export const assetProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'hidden',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['asset'],
			},
		},
		options: [
			{
				name: 'Get Assets',
				value: 'getAssets',
				description: 'Get a list of assets owned by an account',
				action: 'Get a list of assets owned by an account',
			},
			{
				name: 'Mint Asset',
				value: 'mintAsset',
				description: 'Mint an asset from a template',
				action: 'Mint an asset from a template',
			},
			{
				name: 'Transfer Assets',
				value: 'transferAssets',
				description: 'Transfer assets to another account',
				action: 'Transfer assets to another account',
			},
		],
		default: 'getAssets',
	},
	{
		displayName: 'Account Name',
		name: 'account',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['getAssets'],
			},
		},
		description: 'WAX account name',
	},
	{
		displayName: 'Template ID (Optional)',
		name: 'templateId',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['getAssets'],
			},
		},
		description: 'Comma-separated list of template IDs',
	},
	{
		displayName: 'Collection (Optional)',
		name: 'collection',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['getAssets'],
			},
		},
		description: 'Comma-separated list of collections',
	},
	{
		displayName: 'Schema (Optional)',
		name: 'schema',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['getAssets'],
			},
		},
		description: 'Comma-separated list of schemas',
	},
	{
		displayName: 'Code',
		name: 'code',
		type: 'string',
		default: 'atomicassets',
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['getAssets'],
			},
		},
	},
	// Asset transfer parameters
	{
		displayName: 'To Account',
		name: 'to',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['transferAssets'],
			},
		},
	},
	{
		displayName: 'Asset IDs (Comma-Separated)',
		name: 'assetIds',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['transferAssets'],
			},
		},
	},
	{
		displayName: 'Contract',
		name: 'contract',
		type: 'string',
		default: 'atomicassets',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['transferAssets'],
			},
		},
	},
	{
		displayName: 'Memo',
		name: 'memo',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['transferAssets'],
			},
		},
	},
	// Mint asset parameters
	{
		displayName: 'Collection Name',
		name: 'collectionName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'AtomicAssets collection that owns the template',
	},
	{
		displayName: 'Template ID',
		name: 'templateIdMint',
		type: 'number',
		default: 0,
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'ID of the template to mint from. Schema is derived from the template.',
	},
	{
		displayName: 'New Asset Owner',
		name: 'newAssetOwner',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'Account that will receive the minted asset',
	},
	{
		displayName: 'Contract',
		name: 'contractMint',
		type: 'string',
		default: 'atomicassets',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'AtomicAssets contract account. Pin to a literal value - this is signed under your active permission.',
	},
	{
		displayName: 'Immutable Data Override (JSON)',
		name: 'immutableDataMint',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'Per-asset immutable data overrides as a JSON object whose keys/types match the schema format. Usually empty when minting from a template.',
	},
	{
		displayName: 'Mutable Data (JSON)',
		name: 'mutableDataMint',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'Per-asset mutable data as a JSON object whose keys/types match the schema format',
	},
	{
		displayName: 'Back with Assets',
		name: 'backWithAssets',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['asset'],
				operation: ['mintAsset'],
			},
		},
		description: 'Optional comma-separated list of EOSIO asset strings (e.g., "1.00000000 WAX") to back the minted NFT with. Maps to atomicassets::mintasset tokens_to_back.',
	},
];

// Asset operations execution
export async function executeAssetOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData, invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const signing = operation === 'transferAssets' || operation === 'mintAsset';
	const endpoint = validateEndpoint(this, rawEndpoint, { signing });

	if (operation === 'getAssets') {
		const account = requireAccountName(this, this.getNodeParameter('account', i), 'Account Name');
		const templateIdInput = this.getNodeParameter('templateId', i) as string;
		const collectionInput = this.getNodeParameter('collection', i) as string;
		const schemaInput = this.getNodeParameter('schema', i) as string;
		const code = requireAccountName(this, this.getNodeParameter('code', i), 'Code');

		// Parse comma-separated values
		const templateIds = templateIdInput ? templateIdInput.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
		const collections = collectionInput ? collectionInput.split(',').map(c => c.trim()).filter(c => c !== '') : [];
		const schemas = schemaInput ? schemaInput.split(',').map(s => s.trim()).filter(s => s !== '') : [];

		const wax = new WaxJS(endpoint);

		const assets = new Array<WaxAsset>();

		let result: { next_key: null|string, more: boolean, rows?: Array<any>} = { next_key: null, more: true };
		let iterations = 0;
		let lastKey: string | null = null;

		do {
			if (++iterations > MAX_PAGINATION_ITERATIONS) {
				throw new NodeOperationError(this.getNode(), `get_table_rows pagination exceeded ${MAX_PAGINATION_ITERATIONS} iterations`);
			}

			// @ts-ignore
			result = await wax.rpc.get_table_rows({
				json: true,
				code,
				scope: account,
				table: 'assets',
				lower_bound: result.next_key,
				limit: 1000,
				reverse: false,
				show_payer: false,
			});

			if (result.more && result.next_key !== null && result.next_key === lastKey) {
				throw new NodeOperationError(this.getNode(), 'get_table_rows pagination did not advance');
			}
			lastKey = result.next_key;

			// Check if result has the expected structure
			if (!result) {
				throw new NodeOperationError(this.getNode(), 'Empty response from get_table_rows');
			}

			if (!result.hasOwnProperty('rows')) {
				throw new NodeOperationError(this.getNode(), 'Response missing rows property: ' + JSON.stringify(result));
			}

			// Process the rows if they exist
			if (result.rows && Array.isArray(result.rows)) {
				result.rows.forEach((asset: any) => {
					// Skip if asset doesn't match any of the filter criteria
					if (
						(templateIds.length > 0 && !templateIds.includes(asset.template_id)) ||
						(collections.length > 0 && !collections.includes(asset.collection_name)) ||
						(schemas.length > 0 && !schemas.includes(asset.schema_name))
					) {
						return;
					}

					assets.push({
						asset_id: asset.asset_id,
						template_id: asset.template_id,
						collection_name: asset.collection_name,
						schema_name: asset.schema_name,
					});
				});
			}
		} while (result.more && result.rows);

		return {
			returnData: {
				json: {
					account,
					assets
				}
			}
		};
	} else if (operation === 'transferAssets') {
		const credentials = await getCredentials(this);
		const from = requireAccountName(this, credentials.account, 'Credential Account Name');
		const key = credentials.privateKey as string;

		const to = requireAccountName(this, this.getNodeParameter('to', i), 'To Account');
		const memo = normalizeMemo(this, this.getNodeParameter('memo', i), 'Memo');
		const assetIds = requireAssetIds(this, this.getNodeParameter('assetIds', i), 'Asset IDs');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Contract');

		const signatureProvider = new JsSignatureProvider([key]);
		const rpc = new JsonRpc(endpoint, { fetch });

		const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

		const actions = [{
			account: contract,
			name: 'transfer',
			authorization: [{ actor: from, permission: 'active' }],
			data: {
				from,
				to,
				asset_ids: assetIds,
				memo,
			}
		}];

		const result = await api.transact({
			actions
		}, {
			blocksBehind: 3,
			expireSeconds: 30,
		});

		return {
			returnData: {
				json: { result }
			}
		};
	} else if (operation === 'mintAsset') {
		const credentials = await getCredentials(this);
		const from = requireAccountName(this, credentials.account, 'Credential Account Name');
		const key = credentials.privateKey as string;

		const collectionName = requireAccountName(
			this,
			this.getNodeParameter('collectionName', i),
			'Collection Name',
		);
		const templateId = requireTemplateId(
			this,
			this.getNodeParameter('templateIdMint', i),
			'Template ID',
		);
		const newAssetOwner = requireAccountName(
			this,
			this.getNodeParameter('newAssetOwner', i),
			'New Asset Owner',
		);
		const contract = requireAccountName(
			this,
			this.getNodeParameter('contractMint', i),
			'Contract',
		);

		const atomicRpc = createAtomicRpc(this, endpoint, contract);
		await ensureAuthorized(this, atomicRpc, collectionName, from);
		const { schema_name: schemaName } = await ensureTemplateExists(
			this,
			atomicRpc,
			collectionName,
			templateId,
		);
		const format = await fetchSchemaFormat(this, atomicRpc, collectionName, schemaName);

		const immutableData = buildAttributeMap(
			this,
			this.getNodeParameter('immutableDataMint', i),
			format,
			'Immutable Data Override',
		);
		const mutableData = buildAttributeMap(
			this,
			this.getNodeParameter('mutableDataMint', i),
			format,
			'Mutable Data',
		);
		const tokensToBack = parseTokensToBack(
			this,
			this.getNodeParameter('backWithAssets', i),
			'Back with Assets',
		);

		const generator = createActionGenerator(this, contract);
		const actions = await generator.mintasset(
			[{ actor: from, permission: 'active' }],
			from,
			collectionName,
			schemaName,
			templateId,
			newAssetOwner,
			immutableData,
			mutableData,
			tokensToBack,
		);

		const signatureProvider = new JsSignatureProvider([key]);
		const rpc = new JsonRpc(endpoint, { fetch });
		const api = new Api({
			rpc,
			signatureProvider,
			textDecoder: new TextDecoder(),
			textEncoder: new TextEncoder(),
		});

		const result = await api.transact({ actions }, { blocksBehind: 3, expireSeconds: 30 });

		return {
			returnData: {
				json: {
					success: true,
					collection_name: collectionName,
					schema_name: schemaName,
					template_id: templateId,
					new_asset_owner: newAssetOwner,
					transaction: result,
				},
			},
		};
	}

	return {};
}
