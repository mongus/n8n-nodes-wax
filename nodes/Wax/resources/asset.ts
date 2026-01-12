import { IExecuteFunctions, INodeExecutionData, INodeProperties, NodeOperationError } from 'n8n-workflow';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';
import { getCredentials } from './util';
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
];

// Asset operations execution
export async function executeAssetOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData, invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const endpoint = this.getNodeParameter('endpoint', i) as string;

	if (operation === 'getAssets') {
		const account = this.getNodeParameter('account', i) as string;
		const templateIdInput = this.getNodeParameter('templateId', i) as string;
		const collectionInput = this.getNodeParameter('collection', i) as string;
		const schemaInput = this.getNodeParameter('schema', i) as string;
		const code = this.getNodeParameter('code', i) as string;

		// Parse comma-separated values
		const templateIds = templateIdInput ? templateIdInput.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
		const collections = collectionInput ? collectionInput.split(',').map(c => c.trim()).filter(c => c !== '') : [];
		const schemas = schemaInput ? schemaInput.split(',').map(s => s.trim()).filter(s => s !== '') : [];

		// Use JsonRpc instead of WaxJS to avoid constructor issues
		const rpc = new JsonRpc(endpoint, { fetch });

		const assets = new Array<WaxAsset>();

		let result: { next_key: null|string, more: boolean, rows?: Array<any>} = { next_key: null, more: true };

		do {
			result = await rpc.get_table_rows({
				json: true,
				code,
				scope: account,
				table: 'assets',
				lower_bound: result.next_key,
				limit: 1000,
				reverse: false,
				show_payer: false,
			});

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
			} else {
				// If rows is not an array, log the issue but continue
				console.log(`Warning: result.rows is not an array: ${JSON.stringify(result.rows)}`);
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
		const from = credentials.account as string;
		const key = credentials.privateKey as string;

		const to = this.getNodeParameter('to', i) as string;
		const memo = this.getNodeParameter('memo', i) as string;
		const assetIdsString = this.getNodeParameter('assetIds', i) as string;
		const contract = this.getNodeParameter('contract', i) as string;

		const assetIds = assetIdsString.split(',').map(id => id.trim());

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
	}

	return {};
}
