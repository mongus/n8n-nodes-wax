import { IExecuteFunctions, NodeConnectionType } from 'n8n-workflow';
import { INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { TextEncoder, TextDecoder } from 'util';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import {
	normalizeMemo,
	requireAccountName,
	requireAmount,
	requirePrecision,
	requireSymbol,
	validateEndpoint,
} from '../Wax/resources/util';

export class WaxTransferToken implements INodeType {
	description: INodeTypeDescription = {
		hidden: true,
		displayName: 'WAX Transfer Token',
		name: 'waxTransferToken',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Transfer tokens on the WAX blockchain',
		defaults: {
			name: 'Transfer Token',
		},
		credentials: [
			{
				name: 'waxPrivateKeyApi',
				required: true,
			}
		],
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		properties: [
			{
				displayName: 'To Account',
				name: 'to',
				type: 'string',
				default: '',
				required: true,
			},
			{
				displayName: 'Amount',
				name: 'amount',
				type: 'number',
				default: 1,
				required: true,
				description: 'Amount of tokens to transfer (e.g., 1)',
			},
			{
				displayName: 'Symbol',
				name: 'symbol',
				type: 'string',
				default: 'WAX',
				required: true,
				description: 'Token symbol (e.g., "WAX")',
			},
			{
				displayName: 'Precision',
				name: 'precision',
				type: 'number',
				default: 8,
				description: 'Number of decimal places for the token (default is 8)',
			},
			{
				displayName: 'Memo',
				name: 'memo',
				type: 'string',
				default: '',
			},
			{
				displayName: 'API Endpoint',
				name: 'endpoint',
				type: 'string',
				default: 'https://wax.greymass.com',
				required: true,
			},
			{
				displayName: 'Contract',
				name: 'contract',
				type: 'string',
				default: 'eosio.token',
				required: true,
				description: 'Token contract (e.g., "eosio.token" for WAX)',
			}
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const credentials = await this.getCredentials('waxPrivateKeyApi');
			const from = requireAccountName(this, credentials.account, 'Credential Account Name');
			const key = credentials.privateKey as string;

			const to = requireAccountName(this, this.getNodeParameter('to', i), 'To Account');
			const amount = requireAmount(this, this.getNodeParameter('amount', i), 'Amount');
			const symbol = requireSymbol(this, this.getNodeParameter('symbol', i), 'Symbol');
			const precision = requirePrecision(this, this.getNodeParameter('precision', i), 'Precision');
			const memo = normalizeMemo(this, this.getNodeParameter('memo', i), 'Memo');
			const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
			const endpoint = validateEndpoint(this, rawEndpoint, { signing: true });
			const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Contract');

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

			returnData.push({ json: { result } });
		}

		return [returnData];
	}
}
