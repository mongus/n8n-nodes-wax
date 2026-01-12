import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';

import { JsonRpc } from 'eosjs';

interface WaxAsset {
	asset_id: string;
	template_id: string;
	collection_name: string;
	schema_name: string;
}

export class WaxGetAssets implements INodeType {
	description: INodeTypeDescription = {
		hidden: true,
		displayName: 'WAX Get Assets',
		name: 'waxGetAssets',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Get NFTs for an account',
		defaults: {
			name: 'Get Assets',
		},
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		properties: [
			{
				displayName: 'Account Name',
				name: 'account',
				type: 'string',
				default: '',
				required: true,
			},
			{
				displayName: 'Template ID (Optional)',
				name: 'templateId',
				type: 'string',
				default: '',
				description: 'Comma-separated list of template IDs',
			},
			{
				displayName: 'Collection (Optional)',
				name: 'collection',
				type: 'string',
				default: '',
				description: 'Comma-separated list of collections',
			},
			{
				displayName: 'Schema (Optional)',
				name: 'schema',
				type: 'string',
				default: '',
				description: 'Comma-separated list of schemas',
			},
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				default: 'atomicassets',
				required: true,
			},
			{
				displayName: 'API Endpoint',
				name: 'endpoint',
				type: 'string',
				default: 'https://wax.greymass.com',
				required: true,
			},
		],
	};


	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData = [];

		for (let i = 0; i < items.length; i++) {
			const account = this.getNodeParameter('account', i) as string;
			const templateIdInput = this.getNodeParameter('templateId', i) as string;
			const collectionInput = this.getNodeParameter('collection', i) as string;
			const schemaInput = this.getNodeParameter('schema', i) as string;
			const code = this.getNodeParameter('code', i) as string;
			const endpoint = this.getNodeParameter('endpoint', i) as string;

			// Parse comma-separated values
			const templateIds = templateIdInput ? templateIdInput.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
			const collections = collectionInput ? collectionInput.split(',').map(c => c.trim()).filter(c => c !== '') : [];
			const schemas = schemaInput ? schemaInput.split(',').map(s => s.trim()).filter(s => s !== '') : [];

			// Use JsonRpc instead of WaxJS to avoid constructor parameter issues
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

			returnData.push({
				json: {
					account,
					assets
				}
			});
		}

		return [returnData];
	}
}
