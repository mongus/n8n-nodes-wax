import { IExecuteFunctions, INodeExecutionData, INodeProperties, NodeOperationError } from 'n8n-workflow';
import axios from 'axios';
import {
	createSigningApi,
	buildUrl,
	getCredentials,
	redactSensitive,
	requireAccountName,
	requireAmount,
	validateEndpoint,
	requireByteCount,
	requireNonNegativeAmount,
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
				name: 'Create Account',
				value: 'createAccount',
				description: 'Create a new account with RAM and delegated CPU/NET',
				action: 'Create a new account',
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
				operation: ['buyRam', 'createAccount', 'getAccountInfo', 'stakeCpu', 'stakeNet', 'verifyAccount'],
			},
		},
		description: 'WAX account name. For Create Account this is the name of the account being created.',
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
	{
		displayName: 'Owner Public Key',
		name: 'ownerKey',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['createAccount'],
			},
		},
		description: 'Public key for the owner authority. Accepts EOS..., PUB_K1_..., PUB_R1_... or PUB_WA_... (WebAuthn).',
	},
	{
		displayName: 'Active Public Key',
		name: 'activeKey',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['createAccount'],
			},
		},
		description: 'Public key for the active authority. Accepts EOS..., PUB_K1_..., PUB_R1_... or PUB_WA_... (WebAuthn).',
	},
	{
		displayName: 'RAM Bytes',
		name: 'ramBytes',
		type: 'number',
		default: 2048,
		required: true,
		typeOptions: {
			minValue: 128,
		},
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['createAccount'],
			},
		},
		description: 'Exact RAM to purchase, in bytes. Size this to what the account actually uses: surplus RAM can be sold by the account holder and is not recoverable by the payer.',
	},
	{
		displayName: 'Stake CPU (WAX)',
		name: 'stakeCpuAmount',
		type: 'number',
		default: 1,
		typeOptions: {
			minValue: 0,
			numberPrecision: 8,
		},
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['createAccount'],
			},
		},
		description: 'WAX staked for CPU. Ownership is retained by the payer and can be reclaimed with undelegatebw.',
	},
	{
		displayName: 'Stake NET (WAX)',
		name: 'stakeNetAmount',
		type: 'number',
		default: 0.1,
		typeOptions: {
			minValue: 0,
			numberPrecision: 8,
		},
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['createAccount'],
			},
		},
		description: 'WAX staked for NET. Ownership is retained by the payer and can be reclaimed with undelegatebw.',
	},
];

// Every operation here that signs a transaction. Adding an operation without
// listing it means https is not enforced and the chain guard never runs.
const SIGNING_OPERATIONS = new Set(['buyRam', 'stakeCpu', 'stakeNet', 'createAccount']);

const PUBLIC_KEY_RE = /^(EOS[1-9A-HJ-NP-Za-km-z]{50}|PUB_(K1|R1|WA)_[1-9A-HJ-NP-Za-km-z]{40,})$/;

function requirePublicKey(context: IExecuteFunctions, raw: unknown, field: string): string {
	const key = typeof raw === 'string' ? raw.trim() : '';
	if (!key) {
		throw new NodeOperationError(context.getNode(), `${field} is required`);
	}
	if (!PUBLIC_KEY_RE.test(key)) {
		throw new NodeOperationError(
			context.getNode(),
			`${field} must be a legacy EOS key or a PUB_K1_ / PUB_R1_ / PUB_WA_ key`,
		);
	}
	return key;
}

function singleKeyAuthority(key: string) {
	return { threshold: 1, keys: [{ key, weight: 1 }], accounts: [], waits: [] };
}

// Account operations execution
export async function executeAccountOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData; invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const signing = SIGNING_OPERATIONS.has(operation);
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
			const api = await createSigningApi(this, endpoint, credentials);

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
	} else if (operation === 'createAccount') {
		const credentials = await getCredentials(this);
		const creator = requireAccountName(this, credentials.account, 'Credential Account Name');

		const ownerKey = requirePublicKey(this, this.getNodeParameter('ownerKey', i), 'Owner Public Key');
		const activeKey = requirePublicKey(this, this.getNodeParameter('activeKey', i), 'Active Public Key');
		const ramBytes = requireByteCount(this, this.getNodeParameter('ramBytes', i), 'RAM Bytes');
		const stakeCpu = requireNonNegativeAmount(this, this.getNodeParameter('stakeCpuAmount', i), 'Stake CPU (WAX)');
		const stakeNet = requireNonNegativeAmount(this, this.getNodeParameter('stakeNetAmount', i), 'Stake NET (WAX)');

		// Creating a suffixed name (e.g. player.wa) requires the credential
		// account to be the suffix owner.
		const actions: Array<any> = [
			{
				account: 'eosio',
				name: 'newaccount',
				authorization: [{ actor: creator, permission: 'active' }],
				data: {
					creator,
					name: account,
					owner: singleKeyAuthority(ownerKey),
					active: singleKeyAuthority(activeKey),
				},
			},
			{
				account: 'eosio',
				name: 'buyrambytes',
				authorization: [{ actor: creator, permission: 'active' }],
				data: { payer: creator, receiver: account, bytes: ramBytes },
			},
		];

		if (stakeCpu > 0 || stakeNet > 0) {
			actions.push({
				account: 'eosio',
				name: 'delegatebw',
				authorization: [{ actor: creator, permission: 'active' }],
				data: {
					from: creator,
					receiver: account,
					stake_net_quantity: `${stakeNet.toFixed(8)} WAX`,
					stake_cpu_quantity: `${stakeCpu.toFixed(8)} WAX`,
					// Never transfer: staked WAX stays the payer's and is
					// reclaimable. Transferring it hands the value to the
					// account holder, who can unstake and keep it.
					transfer: false,
				},
			});
		}

		try {
			const api = await createSigningApi(this, endpoint, credentials);

			// One transaction, so a failure part-way leaves no half-provisioned
			// account behind.
			const result = await api.transact({ actions }, { blocksBehind: 3, expireSeconds: 30 });

			return {
				returnData: {
					json: {
						success: true,
						operation,
						creator,
						account,
						ownerKey,
						activeKey,
						ramBytes,
						stakeCpu: stakeCpu.toFixed(8),
						stakeNet: stakeNet.toFixed(8),
						transaction: result,
					},
				},
			};
		} catch (error) {
			throw new Error(`Failed to create account: ${redactSensitive(error.message)}`);
		}
	}

	return {};
}
