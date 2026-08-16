import { IExecuteFunctions, INodeExecutionData, INodeProperties, NodeOperationError } from 'n8n-workflow';
import axios from 'axios';
import {
	createSigningApi,
	buildUrl,
	getCredentials,
	normalizeMemo,
	requireAccountName,
	requireAmount,
	requirePrecision,
	requireSymbol,
	validateEndpoint,
} from './util';

// Token resource properties
export const tokenProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'hidden',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['token'],
			},
		},
		options: [
			{
				name: 'Get Account Token Balance',
				value: 'getBalance',
				action: 'Get account token balance',
			},
			{
				name: 'Transfer Tokens',
				value: 'transferTokens',
				description: 'Transfer tokens to another account',
				action: 'Transfer tokens to another account',
			},
			{
				name: 'Issue Tokens',
				value: 'issueTokens',
				description: 'Issue new tokens into circulation. Requires the issuer account key.',
				action: 'Issue new tokens',
			},
			{
				name: 'Retire Tokens',
				value: 'retireTokens',
				description: 'Burn tokens from the issuer balance, reducing supply. Requires the issuer account key.',
				action: 'Retire tokens from circulation',
			},
		],
		default: 'getBalance',
	},
	{
		displayName: 'Account Name',
		name: 'account',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['getBalance'],
			},
		},
		description: 'WAX account name',
	},
	{
		displayName: 'Token Contract',
		name: 'contract',
		type: 'string',
		default: 'eosio.token',
		required: true,
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['getBalance', 'transferTokens', 'issueTokens', 'retireTokens'],
			},
		},
		description: 'Token contract (e.g., "eosio.token" for WAX)',
	},
	{
		displayName: 'Symbol',
		name: 'symbol',
		type: 'string',
		default: 'WAX',
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['getBalance', 'transferTokens', 'issueTokens', 'retireTokens'],
			},
		},
		description: 'Token symbol (e.g., "WAX")',
	},
	// Transfer token parameters
	{
		displayName: 'To Account',
		name: 'to',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['transferTokens', 'issueTokens'],
			},
		},
		description:
			'Recipient account. Most eosio.token contracts only allow issuing to the issuer itself, so for Issue Tokens this is usually the credential account.',
	},
	{
		displayName: 'Amount',
		name: 'amount',
		type: 'number',
		default: 1,
		required: true,
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['transferTokens', 'issueTokens', 'retireTokens'],
			},
		},
		description: 'Amount of tokens to transfer (e.g., 1)',
	},
	{
		displayName: 'Precision',
		name: 'precision',
		type: 'number',
		default: 8,
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['transferTokens', 'issueTokens', 'retireTokens'],
			},
		},
		description: 'Number of decimal places for the token (default is 8)',
	},
	{
		displayName: 'Memo',
		name: 'memo',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['token'],
				operation: ['transferTokens', 'issueTokens', 'retireTokens'],
			},
		},
	},
];

const SIGNING_OPERATIONS = new Set(['transferTokens', 'issueTokens', 'retireTokens']);

// Format an amount as an EOSIO asset string (e.g. "1.00000000 WAX"). The chain
// asserts on exact symbol precision, so a mismatch here is rejected at transact
// time rather than caught locally.
function formatQuantity(amount: number, precision: number, symbol: string): string {
	return `${amount.toFixed(precision)} ${symbol}`;
}

// Token operations execution
export async function executeTokenOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData, invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const endpoint = validateEndpoint(this, rawEndpoint, { signing: SIGNING_OPERATIONS.has(operation) });

	if (operation === 'getBalance') {
		const account = requireAccountName(this, this.getNodeParameter('account', i), 'Account Name');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');
		const rawSymbol = this.getNodeParameter('symbol', i) as string;
		const symbol = rawSymbol ? requireSymbol(this, rawSymbol, 'Symbol') : '';

		const payload: Record<string, string> = { account, code: contract };
		if (symbol) payload.symbol = symbol;

		const { data } = await axios.post(buildUrl(endpoint, '/v1/chain/get_currency_balance'), payload);

		// With no symbol the API returns every balance, and matching on a lone
		// trailing space found none -- so a cleared symbol reported a balance of
		// zero rather than an error, and a workflow gating on "balance >= X" read
		// an unknown as an empty account.
		if (!symbol) {
			throw new NodeOperationError(
				this.getNode(),
				'Symbol is required to read a balance. Without it the account may hold several, and there is no single number to report.',
			);
		}
		const item = data.find((item: string) => item.endsWith(` ${symbol}`)) ?? `0 ${symbol}`;

		const [_balance, _symbol] = item.split(' ');

		const balance = parseFloat(_balance);

		return {
			returnData: {
				json: { account, contract, symbol, balance }
			}
		};
	} else if (operation === 'transferTokens') {
		const credentials = await getCredentials(this);
		const from = requireAccountName(this, credentials.account, 'Credential Account Name');

		const to = requireAccountName(this, this.getNodeParameter('to', i), 'To Account');
		const amount = requireAmount(this, this.getNodeParameter('amount', i), 'Amount');
		const symbol = requireSymbol(this, this.getNodeParameter('symbol', i), 'Symbol');
		const precision = requirePrecision(this, this.getNodeParameter('precision', i), 'Precision');
		const memo = normalizeMemo(this, this.getNodeParameter('memo', i), 'Memo');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');

		const quantity = formatQuantity(amount, precision, symbol);

		const api = await createSigningApi(this, endpoint, credentials);

		const actions = [{
			account: contract,
			name: 'transfer',
			authorization: [{ actor: from, permission: 'active' }],
			data: {
				from,
				to,
				quantity,
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
	} else if (operation === 'issueTokens') {
		const credentials = await getCredentials(this);
		const issuer = requireAccountName(this, credentials.account, 'Credential Account Name');

		const to = requireAccountName(this, this.getNodeParameter('to', i), 'To Account');
		const amount = requireAmount(this, this.getNodeParameter('amount', i), 'Amount');
		const symbol = requireSymbol(this, this.getNodeParameter('symbol', i), 'Symbol');
		const precision = requirePrecision(this, this.getNodeParameter('precision', i), 'Precision');
		const memo = normalizeMemo(this, this.getNodeParameter('memo', i), 'Memo');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');

		const quantity = formatQuantity(amount, precision, symbol);

		const api = await createSigningApi(this, endpoint, credentials);

		const actions = [{
			account: contract,
			name: 'issue',
			authorization: [{ actor: issuer, permission: 'active' }],
			data: {
				to,
				quantity,
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
	} else if (operation === 'retireTokens') {
		const credentials = await getCredentials(this);
		const issuer = requireAccountName(this, credentials.account, 'Credential Account Name');

		const amount = requireAmount(this, this.getNodeParameter('amount', i), 'Amount');
		const symbol = requireSymbol(this, this.getNodeParameter('symbol', i), 'Symbol');
		const precision = requirePrecision(this, this.getNodeParameter('precision', i), 'Precision');
		const memo = normalizeMemo(this, this.getNodeParameter('memo', i), 'Memo');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');

		const quantity = formatQuantity(amount, precision, symbol);

		const api = await createSigningApi(this, endpoint, credentials);

		const actions = [{
			account: contract,
			name: 'retire',
			authorization: [{ actor: issuer, permission: 'active' }],
			data: {
				quantity,
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
