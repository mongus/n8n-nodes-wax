import {
	IExecuteFunctions,
	INodeExecutionData, INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';

import { properties, executeOperation } from './resources';
import { safeError } from './resources/util';

const subtitle = `={{ ( { ${Object.entries(properties.reduce((acc, prop) => {
	if (prop.name === 'operation') {
		prop.options?.forEach(option => {
			const value = (option as INodePropertyOptions).value;
			if (value)
				acc[String(value)] = option.name;
		});
	}

	return acc;
}, {} as {[operation: string]: string }))
	.map(([key, value]) => `"${key}": "${value}"`)
	.join(', ') } } )[$parameter["operation"]] }}`;

export class Wax implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WAX',
		name: 'wax',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		subtitle,//: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Interact with the WAX blockchain',
		defaults: {
			name: 'WAX',
		},
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		outputNames: ['data'],
		credentials: [
			{
				name: 'waxPrivateKeyApi',
				required: false,
			},
		],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const result = await executeOperation.call(this, items, i);

				// Add the result to the returnData array
				if (result?.returnData) {
					returnData.push(result.returnData);
				}

				// We no longer use invalidData as everything goes through returnData
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: safeError(error).message } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
