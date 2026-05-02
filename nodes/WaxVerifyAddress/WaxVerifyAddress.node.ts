import { IExecuteFunctions, INodeTypeDescription, NodeConnectionType } from 'n8n-workflow';
import { INodeExecutionData, INodeType } from 'n8n-workflow';
import axios from 'axios';
import { buildUrl, validateEndpoint } from '../Wax/resources/util';

export class WaxVerifyAddress implements INodeType {
	description: INodeTypeDescription = {
		hidden: true,
		displayName: 'WAX Verify Address',
		name: 'waxVerifyAddress',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Verify an address exists on the WAX blockchain',
		defaults: {
			name: 'Verify Address',
		},
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main', 'main'] as NodeConnectionType[],
		outputNames: ['valid', 'invalid'],
		properties: [
			{
				displayName: 'Account Name',
				name: 'account',
				type: 'string',
				default: '',
				required: true,
				description: 'WAX account name to verify',
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
		const validData = [];
		const invalidData = [];

		for (let i = 0; i < items.length; i++) {
			const account = this.getNodeParameter('account', i) as string;
			const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
			const endpoint = validateEndpoint(this, rawEndpoint);

			try {
				// Try to get the account info
				const result = await axios.post(buildUrl(endpoint, '/v1/chain/get_account'), { account_name: account });

				// If no error is thrown, the account exists
				validData.push({
					json: {
						account,
						created: result.data.created,
						message: 'Account exists on the WAX blockchain'
					}
				});
			} catch (error) {
				// If we get an error, the account likely doesn't exist
				// Check if it's a 404 or other specific error related to account not found
				let message = 'Account does not exist on the WAX blockchain';

				// If it's an axios error, we can get more details
				if (axios.isAxiosError(error) && error.response) {
					// Some APIs return specific error codes or messages for non-existent accounts
					if (error.response.status === 404) {
						message = 'Account not found (404)';
					} else if (error.response.data && error.response.data.error) {
						// WAX API often returns error details in the response data
						message = `Account verification failed: ${error.response.data.error.what || error.response.data.error}`;
					}
				}

				invalidData.push({
					json: {
						account,
						message
					}
				});
			}
		}

		// Return data for both outputs: [valid, invalid]
		return [validData, invalidData];
	}
}
