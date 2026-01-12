import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder } from 'util';

export class WaxMultiAction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WAX Multi Action',
		name: 'waxMultiAction',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Execute multiple actions in a single WAX transaction',
		defaults: {
			name: 'WAX Multi Action',
		},
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [
			{
				name: 'waxPrivateKeyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'API Endpoint',
				name: 'endpoint',
				type: 'string',
				default: 'https://wax.greymass.com',
				required: true,
				description: 'WAX blockchain API endpoint',
			},
			{
				displayName: 'Actions',
				name: 'actions',
				type: 'fixedCollection',
				default: {},
				typeOptions: {
					multipleValues: true,
				},
				options: [
					{
						name: 'actionItem',
						displayName: 'Action',
						values: [
							{
								displayName: 'Contract Account',
								name: 'account',
								type: 'string',
								default: '',
								required: true,
								description: 'The smart contract account to interact with',
							},
							{
								displayName: 'Action Name',
								name: 'name',
								type: 'string',
								default: '',
								required: true,
								description: 'Name of the action to execute',
							},
							{
								displayName: 'Authorization',
								name: 'authorization',
								type: 'fixedCollection',
								default: {},
								typeOptions: {
									multipleValues: true,
								},
								options: [
									{
										name: 'authItem',
										displayName: 'Authorization',
										values: [
											{
												displayName: 'Actor',
												name: 'actor',
												type: 'string',
												default: '',
												required: true,
												description: 'Account name that authorizes the action',
											},
											{
												displayName: 'Permission',
												name: 'permission',
												type: 'options',
												options: [
													{
														name: 'Active',
														value: 'active',
													},
													{
														name: 'Owner',
														value: 'owner',
													},
													{
														name: 'Custom',
														value: 'custom',
													},
												],
												default: 'active',
												description: 'Permission level for the authorization',
											},
											{
												displayName: 'Custom Permission',
												name: 'customPermission',
												type: 'string',
												default: '',
												displayOptions: {
													show: {
														permission: ['custom'],
													},
												},
												description: 'Custom permission name',
											},
										],
									},
								],
								description: 'Authorization for the action',
							},
							{
								displayName: 'Action Data (JSON)',
								name: 'data',
								type: 'json',
								default: '{}',
								required: true,
								description: 'JSON data for the action',
							},
						],
					},
				],
				description: 'Actions to execute in the transaction',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				// Get credentials
				const credentials = await this.getCredentials('waxPrivateKeyApi');
				const privateKey = credentials.privateKey as string;

				// Get endpoint
				const endpoint = this.getNodeParameter('endpoint', i) as string;

				// Get actions
				const actionsData = this.getNodeParameter('actions', i) as any;

				if (!actionsData.actionItem || actionsData.actionItem.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'At least one action must be defined',
						{ itemIndex: i }
					);
				}

				// Build actions array
				const actions: Array<any> = [];

				for (const actionItem of actionsData.actionItem) {
					// Parse action data
					let actionData: any;
					try {
						actionData = typeof actionItem.data === 'string'
							? JSON.parse(actionItem.data)
							: actionItem.data;
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON in action data for action "${actionItem.name}": ${error.message}`,
							{ itemIndex: i }
						);
					}

					// Build authorization
					const authorization: Array<{ actor: string; permission: string }> = [];

					if (actionItem.authorization && actionItem.authorization.authItem) {
						for (const auth of actionItem.authorization.authItem) {
							const permission = auth.permission === 'custom'
								? auth.customPermission
								: auth.permission;

							authorization.push({
								actor: auth.actor,
								permission: permission,
							});
						}
					} else {
						// Default authorization using credentials account
						const defaultActor = credentials.account as string;
						authorization.push({
							actor: defaultActor,
							permission: 'active',
						});
					}

					// Add action to array
					actions.push({
						account: actionItem.account,
						name: actionItem.name,
						authorization,
						data: actionData,
					});
				}

				// Setup EOSJS
				const signatureProvider = new JsSignatureProvider([privateKey]);
				const rpc = new JsonRpc(endpoint, { fetch });
				const api = new Api({
					rpc,
					signatureProvider,
					textDecoder: new TextDecoder(),
					textEncoder: new TextEncoder(),
				});

				// Execute the transaction
				const result = await api.transact(
					{ actions },
					{
						blocksBehind: 3,
						expireSeconds: 30,
					}
				);

				// Type guard to check if result is a transaction result
				const isTransactionResult = (res: any): res is {
					transaction_id: string;
					processed: any;
				} => {
					return res &&
						typeof res.transaction_id === 'string' &&
						res.processed &&
						typeof res.processed === 'object';
				};

				returnData.push({
					json: {
						success: true,
						actionsCount: actions.length,
						actions: actions.map((action) => ({
							account: action.account,
							name: action.name,
							authorization: action.authorization,
						})),
						transaction: isTransactionResult(result) ? {
							transaction_id: result.transaction_id,
							processed: result.processed,
						} : {
							result: result,
							note: 'Transaction executed but response format may vary'
						},
					},
				});

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: error.message,
							details: error.response?.data || error.stack,
						},
					});
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					`WAX Multi Action operation failed: ${error.message}`,
					{ itemIndex: i }
				);
			}
		}

		return [returnData];
	}
}
