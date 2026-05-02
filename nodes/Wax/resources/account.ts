import { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import axios from 'axios';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';
import {
	buildUrl,
	getCredentials,
	redactSensitive,
	requireAccountName,
	requireAmount,
	validateEndpoint,
} from './util';

// Account resource properties
export const accountProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'hidden',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['account'],
			},
		},
		options: [
			{
				name: 'Buy RAM',
				value: 'buyRam',
				action: 'Buy RAM',
			},
			{
				name: 'Get Account Info',
				value: 'getAccountInfo',
				description: 'Get account information',
				action: 'Get account information',
			},
			{
				name: 'Stake CPU',
				value: 'stakeCpu',
				description: 'Stake WAX for CPU resources',
				action: 'Stake WAX for CPU resources',
			},
			{
				name: 'Stake NET',
				value: 'stakeNet',
				description: 'Stake WAX for NET resources',
				action: 'Stake WAX for NET resources',
			},
			{
				name: 'Verify Account',
				value: 'verifyAccount',
				description: 'Verify an account exists',
				action: 'Verify an account exists',
			},
		],
		default: 'getAccountInfo',
	},
	{
		displayName: 'Account Name',
		name: 'account',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['buyRam', 'getAccountInfo', 'stakeCpu', 'stakeNet', 'verifyAccount'],
			},
		},
		description: 'WAX account name',
	},
	// Buy/Stake parameters
	{
		displayName: 'Amount (WAX)',
		name: 'amount',
		type: 'number',
		default: 1,
		required: true,
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['buyRam', 'stakeCpu', 'stakeNet'],
			},
		},
		description: 'Amount of WAX',
	},
	{
		displayName: 'Transfer Stake to New Account',
		name: 'transfer',
		type: 'boolean',
		default: false,
		required: true,
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['stakeCpu', 'stakeNet'],
			},
		},
		description: 'Whether to transfer ownership of the staked tokens to the new account',
	},
];

// Account operations execution
export async function executeAccountOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData; invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const signing = operation === 'buyRam' || operation === 'stakeCpu' || operation === 'stakeNet';
	const endpoint = validateEndpoint(this, rawEndpoint, { signing });

	const account = requireAccountName(this, this.getNodeParameter('account', i), 'Account Name');

	if (operation === 'getAccountInfo' || operation === 'verifyAccount') {
		if (operation === 'getAccountInfo') {
			// Get account info
			const response = await axios.post(buildUrl(endpoint, '/v1/chain/get_account'), {
				account_name: account,
			});
			return { returnData: { json: response.data } };
		} else if (operation === 'verifyAccount') {
			try {
				// Verify address
				const result = await axios.post(buildUrl(endpoint, '/v1/chain/get_account'), {
					account_name: account,
				});

				return {
					returnData: {
						json: {
							account,
							exists: true,
							created: result.data.created,
						},
					},
				};
			} catch (error) {
				if (axios.isAxiosError(error) && [400, 404].includes(error.response?.status ?? 0)) {
					return {
						returnData: {
							json: {
								account,
								exists: false,
								error: 'Account does not exist on the WAX blockchain',
							},
						},
					}; // Account does not exist
				}

				throw new Error(`Failed to verify account: ${redactSensitive(error.message)}`);
			}
		}
	} else if (operation === 'buyRam' || operation === 'stakeCpu' || operation === 'stakeNet') {
		// These operations require authentication
		const credentials = await getCredentials(this);
		const from = requireAccountName(this, credentials.account, 'Credential Account Name');

		// Get operation parameters
		const amount = requireAmount(this, this.getNodeParameter('amount', i), 'Amount');

		let actions: Array<any> = [];
		let formattedAmount = '';

		if (operation === 'buyRam') {
			// Format the amount with 8 decimal places for WAX
			formattedAmount = amount.toFixed(8);

			actions = [{
				account: 'eosio',
				name: 'buyram',
				authorization: [{ actor: from, permission: 'active' }],
				data: {
					payer: from,
					receiver: account,
					quant: `${formattedAmount} WAX`,
				}
			}];
		} else if (operation === 'stakeCpu' || operation === 'stakeNet') {
			// Format the amount with 8 decimal places for WAX
			formattedAmount = amount.toFixed(8);

			const transfer = this.getNodeParameter('transfer', i) as boolean;

			// For staking, we need to specify how much goes to CPU and how much to NET
			const cpuAmount = operation === 'stakeCpu' ? formattedAmount : '0.00000000';
			const netAmount = operation === 'stakeNet' ? formattedAmount : '0.00000000';

			actions = [{
				account: 'eosio',
				name: 'delegatebw',
				authorization: [{ actor: from, permission: 'active' }],
				data: {
					from: from,
					receiver: account,
					stake_net_quantity: `${netAmount} WAX`,
					stake_cpu_quantity: `${cpuAmount} WAX`,
					transfer: transfer,
				}
			}];
		}

		try {
			// Setup eosjs
			const key = credentials.privateKey as string;
			const signatureProvider = new JsSignatureProvider([key]);
			const rpc = new JsonRpc(endpoint, { fetch });
			const api = new Api({
				rpc,
				signatureProvider,
				textDecoder: new TextDecoder(),
				textEncoder: new TextEncoder()
			});

			// Execute the transaction
			const result = await api.transact({
				actions
			}, {
				blocksBehind: 3,
				expireSeconds: 30,
			});

			return {
				returnData: {
					json: {
						success: true,
						operation,
						from,
						receiver: account,
						amount: formattedAmount,
						transaction: result
					}
				}
			};
		} catch (error) {
			throw new Error(`Failed to execute ${operation}: ${redactSensitive(error.message)}`);
		}
	}

	return {};
}
