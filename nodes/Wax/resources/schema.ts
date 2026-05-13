import { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { createAtomicRpc, fetchSchemaFormat } from './atomic';
import { requireAccountName, validateEndpoint } from './util';

export const schemaProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'hidden',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['schema'],
			},
		},
		options: [
			{
				name: 'Get Schema Format',
				value: 'getSchemaFormat',
				description: 'Retrieve the field definitions of a schema',
				action: 'Retrieve the field definitions of a schema',
			},
		],
		default: 'getSchemaFormat',
	},
	{
		displayName: 'Collection Name',
		name: 'collectionName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['schema'],
				operation: ['getSchemaFormat'],
			},
		},
		description: 'AtomicAssets collection that owns the schema',
	},
	{
		displayName: 'Schema Name',
		name: 'schemaName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['schema'],
				operation: ['getSchemaFormat'],
			},
		},
	},
];

export async function executeSchemaOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData; invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const endpoint = validateEndpoint(this, rawEndpoint);

	if (operation === 'getSchemaFormat') {
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

		const rpc = createAtomicRpc(this, endpoint);
		const format = await fetchSchemaFormat(this, rpc, collectionName, schemaName);

		return {
			returnData: {
				json: {
					collection_name: collectionName,
					schema_name: schemaName,
					format,
				},
			},
		};
	}

	return {};
}
