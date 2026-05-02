import { IExecuteFunctions, INodeTypeDescription, NodeConnectionType } from 'n8n-workflow';
import { INodeExecutionData, INodeType } from 'n8n-workflow';
import axios from 'axios';
import { buildUrl, requireAccountName, validateEndpoint } from '../Wax/resources/util';

export class WaxGetAccountInfo implements INodeType {
	description: INodeTypeDescription ={
		hidden: true,
		displayName: 'WAX Get Account Info',
		name: 'waxGetAccountInfo',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Fetch account details from the WAX blockchain',
		defaults: {
			name: 'Get Account Info',
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
				displayName: 'API Endpoint',
				name: 'endpoint',
				type: 'string',
				default: 'https://wax.greymass.com',
				required: true,
			}
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const returnData = [];

		for (let i = 0; i < items.length; i++) {
			const account = requireAccountName(this, this.getNodeParameter('account', i), 'Account Name');
			const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
			const endpoint = validateEndpoint(this, rawEndpoint);

			const response = await axios.post(buildUrl(endpoint, '/v1/chain/get_account'), { account_name: account });

			returnData.push({ json: response.data });
		}

		return [returnData];
	}
}
