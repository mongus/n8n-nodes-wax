import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';
import axios from 'axios';
import { buildUrl, requireAccountName, requireSymbol, validateEndpoint } from '../Wax/resources/util';

export class WaxGetBalance implements INodeType {
	description: INodeTypeDescription = {
		hidden: true,
		displayName: 'WAX Get Balance',
		name: 'waxGetBalance',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Get token balance for an account',
		defaults: {
			name: 'Get Balance',
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
				displayName: 'Token Contract',
				name: 'contract',
				type: 'string',
				default: 'eosio.token',
				required: true,
			},
			{
				displayName: 'Symbol',
				name: 'symbol',
				type: 'string',
				default: 'WAX',
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
			const contract = requireAccountName(this, this.getNodeParameter('contract', i), 'Token Contract');
			const rawSymbol = this.getNodeParameter('symbol', i) as string;
			const symbol = rawSymbol ? requireSymbol(this, rawSymbol, 'Symbol') : '';
			const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
			const endpoint = validateEndpoint(this, rawEndpoint);

			const payload: Record<string, string> = { account, code: contract };
			if (symbol) payload.symbol = symbol;

			const { data } = await axios.post(buildUrl(endpoint, '/v1/chain/get_currency_balance'), payload);

			const item = data.find((item: string) => item.endsWith(` ${symbol}`)) ?? `0 ${symbol}`;

			const [_balance, _symbol] = item.split(' ');

			const balance = parseFloat(_balance);

			returnData.push({ json: { account, contract, symbol, balance } });//balance, symbol: _symbol } });
		}

		return [returnData];
	}
}
