import { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import axios from 'axios';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';
import {
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
				operation: ['getBalance', 'transferTokens'],
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
				operation: ['getBalance', 'transferTokens'],
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
				operation: ['transferTokens'],
			},
		},
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
				operation: ['transferTokens'],
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
				operation: ['transferTokens'],
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
				operation: ['transferTokens'],
			},
		},
	},
];

// Token operations execution
export async function executeTokenOperations(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	i: number,
): Promise<{ returnData?: INodeExecutionData, invalidData?: INodeExecutionData }> {
	const operation = this.getNodeParameter('operation', i) as string;
	const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
	const endpoint = validateEndpoint(this, rawEndpoint, { signing: operation === 'transferTokens' });

	if (operation === 'getBalance') {
		const account = requireAccountName(this, this.getNodeParameter('account', i), 'Account Name');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');
		const rawSymbol = this.getNodeParameter('symbol', i) as string;
		const symbol = rawSymbol ? requireSymbol(this, rawSymbol, 'Symbol') : '';

		const payload: Record<string, string> = { account, code: contract };
		if (symbol) payload.symbol = symbol;

		const { data } = await axios.post(buildUrl(endpoint, '/v1/chain/get_currency_balance'), payload);

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
		const key = credentials.privateKey as string;

		const to = requireAccountName(this, this.getNodeParameter('to', i), 'To Account');
		const amount = requireAmount(this, this.getNodeParameter('amount', i), 'Amount');
		const symbol = requireSymbol(this, this.getNodeParameter('symbol', i), 'Symbol');
		const precision = requirePrecision(this, this.getNodeParameter('precision', i), 'Precision');
		const memo = normalizeMemo(this, this.getNodeParameter('memo', i), 'Memo');
		const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');

		// Format the quantity as "amount symbol" (e.g., "1.00000000 WAX")
		// Ensure the amount has 8 decimal places for proper formatting
		const formattedAmount = amount.toFixed(precision);
		const quantity = `${formattedAmount} ${symbol}`;

		const signatureProvider = new JsSignatureProvider([key]);
		const rpc = new JsonRpc(endpoint, { fetch });

		const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

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
	}

	return {};
}
