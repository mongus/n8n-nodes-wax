import { IExecuteFunctions, NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import { INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import {
	createSigningApi,
	normalizeMemo,
	requireAccountName,
	requireAmount,
	requirePrecision,
	requireSymbol,
	validateEndpoint,
	redactSensitive,
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
			try {
			const credentials = await this.getCredentials('waxPrivateKeyApi');
			const from = requireAccountName(this, credentials.account, 'Credential Account Name');

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

				returnData.push({ json: { result }, pairedItem: { item: i } });
			} catch (error) {
				// Transfers already broadcast in this run are irreversible. Throwing
				// without them meant their transaction ids were discarded with the
				// error, and a workflow retried from the start re-sent them -- real
				// assets moved twice. The successes are returned either way; the
				// error is attached to the item that failed.
				const message = redactSensitive(error instanceof Error ? error.message : String(error));
				if (this.continueOnFail()) {
					returnData.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					`${message} (${returnData.length} transfer(s) already sent in this run and reported below -- do not simply retry)`,
					{ itemIndex: i },
				);
			}
		}

		return [returnData];
	}
}
