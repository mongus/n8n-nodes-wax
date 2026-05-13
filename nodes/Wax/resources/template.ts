import { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';
import {
	buildAttributeMap,
	createActionGenerator,
	createAtomicRpc,
	ensureAuthorized,
	fetchSchemaFormat,
	requireMaxSupply,
} from './atomic';
import { getCredentials, requireAccountName, validateEndpoint } from './util';

export const templateProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'hidden',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['template'],
			},
		},
		options: [
			{
				name: 'Create Template',
				value: 'createTemplate',
				description: 'Create a template in a collection under a schema',
				action: 'Create a template in a collection under a schema',
			},
		],
		default: 'createTemplate',
	},
	{
		displayName: 'Collection Name',
		name: 'collectionName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
	},
	{
		displayName: 'Schema Name',
		name: 'schemaName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
	},
	{
		displayName: 'Transferable',
		name: 'transferable',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
		description: 'Whether assets minted from this template can be transferred',
	},
	{
		displayName: 'Burnable',
		name: 'burnable',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
		description: 'Whether assets minted from this template can be burned',
	},
	{
		displayName: 'Max Supply',
		name: 'maxSupply',
		type: 'number',
		default: 0,
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
		description: 'Maximum number of assets that may be minted from this template (0 = unlimited)',
	},
	{
		displayName: 'Contract',
		name: 'contract',
		type: 'string',
		default: 'atomicassets',
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
		description: 'AtomicAssets contract account. Pin to a literal value - this is signed under your active permission.',
	},
	{
		displayName: 'Immutable Data (JSON)',
		name: 'immutableData',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['createTemplate'],
			},
		},
		description: 'Per-template data as a JSON object whose keys/types match the schema format',
	},
];

export async function executeTemplateOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData; invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const endpoint = validateEndpoint(this, rawEndpoint, { signing: true });

	if (operation === 'createTemplate') {
		const credentials = await getCredentials(this);
		const from = requireAccountName(this, credentials.account, 'Credential Account Name');
		const key = credentials.privateKey as string;

		const collectionName = requireAccountName(
			this,
			this.getNodeParameter('collectionName', i),
			'Collection Name',
		);
		const schemaName = requireAccountName(
			this,
			this.getNodeParameter('schemaName', i),
			'Schema Name',
		);
		const transferable = this.getNodeParameter('transferable', i) as boolean;
		const burnable = this.getNodeParameter('burnable', i) as boolean;
		const maxSupply = requireMaxSupply(this, this.getNodeParameter('maxSupply', i), 'Max Supply');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Contract');

		const atomicRpc = createAtomicRpc(this, endpoint, contract);
		await ensureAuthorized(this, atomicRpc, collectionName, from);
		const format = await fetchSchemaFormat(this, atomicRpc, collectionName, schemaName);
		const immutableData = buildAttributeMap(
			this,
			this.getNodeParameter('immutableData', i),
			format,
			'Immutable Data',
		);

		const generator = createActionGenerator(this, contract);
		const actions = await generator.createtempl(
			[{ actor: from, permission: 'active' }],
			from,
			collectionName,
			schemaName,
			transferable,
			burnable,
			maxSupply,
			immutableData,
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
					transaction: result,
				},
			},
		};
	}

	return {};
}
