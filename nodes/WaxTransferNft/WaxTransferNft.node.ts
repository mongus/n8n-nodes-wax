import { IExecuteFunctions, NodeConnectionType } from 'n8n-workflow';
import { INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { TextEncoder, TextDecoder } from 'util';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { validateEndpoint } from '../Wax/resources/util';

export class WaxTransferNft implements INodeType {
	description: INodeTypeDescription = {
		hidden: true,
		displayName: 'WAX Transfer NFT',
		name: 'waxTransferNft',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Transfer an NFT on the WAX blockchain',
		defaults: {
			name: 'Transfer NFT',
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
				displayName: 'Asset IDs (Comma-Separated)',
				name: 'assetIds',
				type: 'string',
				default: '',
				required: true,
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
				default: 'atomicassets',
			}
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const credentials = await this.getCredentials('waxPrivateKeyApi');
			const from = credentials.account as string;
			const key = credentials.privateKey as string;

			const to = this.getNodeParameter('to', i) as string;
			const memo = this.getNodeParameter('memo', i) as string;
			const rawEndpoint = this.getNodeParameter('endpoint', i) as string;
			const endpoint = validateEndpoint(this, rawEndpoint, { signing: true });
			const assetIdsString = this.getNodeParameter('assetIds', i) as string;
			const contract = this.getNodeParameter('contract', i) as string;

			const assetIds = assetIdsString.split(',').map(id => id.trim());

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
					asset_ids: assetIds,
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
