import { INodeProperties } from 'n8n-workflow';

// Common interfaces
export interface WaxAsset {
	asset_id: string;
	template_id: string;
	collection_name: string;
	schema_name: string;
}

// Common properties that are shared across multiple resource types
export const commonProperties: INodeProperties[] = [
	{
		displayName: 'API Endpoint',
		name: 'endpoint',
		type: 'string',
		default: 'https://wax.greymass.com',
		required: true,
		description: 'WAX blockchain API endpoint',
	},
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'hidden',
		noDataExpression: true,
		options: [
			{
				name: 'Account',
				value: 'account',
			},
			{
				name: 'Token',
				value: 'token',
			},
			{
				name: 'Asset',
				value: 'asset',
			},
			{
				name: 'Template',
				value: 'template',
			},
			{
				name: 'Schema',
				value: 'schema',
			},
		],
		default: 'account',
	},
];
