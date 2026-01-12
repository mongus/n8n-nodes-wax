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

// Fonction pour convertir un nom de compte WAX en i64
function nameToI64(name: string, node: any): string {
	const chars = '.12345abcdefghijklmnopqrstuvwxyz';
	let value = BigInt(0);

	// Pad name to 12 characters with dots
	name = name.padEnd(12, '.');

	for (let i = 0; i < 12; i++) {
		const char = name[i];
		const charValue = chars.indexOf(char);
		if (charValue === -1) {
			throw new NodeOperationError(
				node,
				`Invalid character in name: ${char}`
			);
		}
		value = value | (BigInt(charValue & 0x1f) << BigInt(64 - 5 * (i + 1)));
	}

	return value.toString();
}

// Type guard to check if a result is a transaction result
function isWaxTransactionResult(result: any): result is {
	transaction_id: string;
	processed: any;
} {
	return result &&
		typeof result.transaction_id === 'string' &&
		result.processed &&
		typeof result.processed === 'object';
}

export class WaxSmartContract implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WAX Smart Contract',
		name: 'waxSmartContract',
		icon: 'file:wax.svg',
		group: ['transform'],
		version: 1,
		description: 'Execute actions on WAX smart contracts',
		defaults: {
			name: 'WAX Smart Contract',
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
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Execute Action',
						value: 'executeAction',
						description: 'Execute an action on a smart contract',
						action: 'Execute a smart contract action',
					},
					{
						name: 'Get Table Data',
						value: 'getTable',
						description: 'Read data from a smart contract table',
						action: 'Get smart contract table data',
					},
				],
				default: 'executeAction',
			},
			// Contract parameters
			{
				displayName: 'Contract Name',
				name: 'contractName',
				type: 'string',
				default: '',
				required: true,
				description: 'Name of the smart contract (e.g., eosio.token, atomicassets)',
			},
			// Execute Action parameters
			{
				displayName: 'Action Name',
				name: 'actionName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['executeAction'],
					},
				},
				description: 'Name of the contract action to execute',
			},
			{
				displayName: 'Action Data',
				name: 'actionData',
				type: 'json',
				default: '{}',
				required: true,
				displayOptions: {
					show: {
						operation: ['executeAction'],
					},
				},
				description: 'JSON data to send with the action',
			},
			{
				displayName: 'Authorization',
				name: 'authorization',
				type: 'fixedCollection',
				default: {},
				displayOptions: {
					show: {
						operation: ['executeAction'],
					},
				},
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
				description: 'Authorization required for the action',
			},
			// Get Table parameters
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Name of the table to query',
			},
			{
				displayName: 'Scope',
				name: 'scope',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Scope of the table (usually an account name or contract name)',
			},
			{
				displayName: 'Lower Bound',
				name: 'lowerBound',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Lower bound for the query (optional). Use account names for name type, numbers for i64.',
			},
			{
				displayName: 'Upper Bound',
				name: 'upperBound',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Upper bound for the query (optional). Use account names for name type, numbers for i64.'
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Key Type',
				name: 'keyType',
				type: 'options',
				options: [
					{ name: 'Float128', value: 'float128' },
					{ name: 'Float64', value: 'float64' },
					{ name: 'I128', value: 'i128' },
					{ name: 'I256', value: 'i256' },
					{ name: 'I64', value: 'i64' },
					{ name: 'Name', value: 'name' },
					{ name: 'Ripemd160', value: 'ripemd160' },
					{ name: 'Sha256', value: 'sha256' },
				],
				default: 'i64',
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Type of the primary key',
			},
			{
				displayName: 'Auto Convert Account Names',
				name: 'autoConvert',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['getTable'],
						keyType: ['i64'],
					},
				},
				description: 'Whether to automatically convert account names in bounds to i64 format',
			},
			{
				displayName: 'Index Position',
				name: 'indexPosition',
				type: 'number',
				default: 1,
				displayOptions: {
					show: {
						operation: ['getTable'],
					},
				},
				description: 'Position of the index (1 for primary, 2+ for secondary indexes)',
			},
			// Common parameters
			{
				displayName: 'API Endpoint',
				name: 'endpoint',
				type: 'string',
				default: 'https://wax.greymass.com',
				required: true,
				description: 'WAX blockchain API endpoint',
			},
			{
				displayName: 'Memo (Optional)',
				name: 'memo',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['executeAction'],
					},
				},
				description: 'Optional memo for the transaction',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const contractName = this.getNodeParameter('contractName', i) as string;
				const endpoint = this.getNodeParameter('endpoint', i) as string;

				if (operation === 'executeAction') {
					// Get credentials for signing
					const credentials = await this.getCredentials('waxPrivateKeyApi');
					const privateKey = credentials.privateKey as string;

					// Get action parameters
					const actionName = this.getNodeParameter('actionName', i) as string;
					const actionDataString = this.getNodeParameter('actionData', i) as string;
					const authorizationData = this.getNodeParameter('authorization', i) as any;
					const memo = this.getNodeParameter('memo', i) as string;

					// Parse action data
					let actionData: any;
					try {
						actionData = typeof actionDataString === 'string'
							? JSON.parse(actionDataString)
							: actionDataString;
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON in action data: ${error.message}`,
							{ itemIndex: i }
						);
					}

					// Build authorization array
					const authorization: Array<{ actor: string; permission: string }> = [];

					if (authorizationData && authorizationData.authItem) {
						for (const auth of authorizationData.authItem) {
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
					const actions = [
						{
							account: contractName,
							name: actionName,
							authorization,
							data: actionData,
						},
					];

					const result = await api.transact(
						{ actions },
						{
							blocksBehind: 3,
							expireSeconds: 30,
						}
					);

					// Safe handling of transaction result
					returnData.push({
						json: {
							success: true,
							operation: 'executeAction',
							contract: contractName,
							action: actionName,
							actionData,
							authorization,
							memo,
							transaction: isWaxTransactionResult(result) ? {
								transaction_id: result.transaction_id,
								processed: result.processed,
							} : {
								result: result,
								note: 'Transaction executed but response format may vary'
							},
						},
					});

				} else if (operation === 'getTable') {
					// Get table parameters
					const tableName = this.getNodeParameter('tableName', i) as string;
					const scope = this.getNodeParameter('scope', i) as string;
					const lowerBound = this.getNodeParameter('lowerBound', i) as string;
					const upperBound = this.getNodeParameter('upperBound', i) as string;
					const limit = this.getNodeParameter('limit', i) as number;
					const keyType = this.getNodeParameter('keyType', i) as string;
					const indexPosition = this.getNodeParameter('indexPosition', i) as number;
					const autoConvert = this.getNodeParameter('autoConvert', i) as boolean;

					// Setup RPC connection
					const rpc = new JsonRpc(endpoint, { fetch });

					// Build query parameters
					const queryParams: any = {
						json: true,
						code: contractName,
						scope,
						table: tableName,
						limit,
						reverse: false,
						show_payer: false,
						index_position: indexPosition,
						key_type: "",
						lower_bound : "",
						upper_bound : ""
					};

					// Handle bounds with auto-conversion for i64
					let processedLowerBound = lowerBound;
					let processedUpperBound = upperBound;

					if (keyType === 'i64' && autoConvert) {
						// Check if bounds look like account names (contains letters, dots, numbers but not pure numbers)
						if (lowerBound && !/^\d+$/.test(lowerBound) && /^[a-z1-5.]{1,12}$/.test(lowerBound)) {
							try {
								processedLowerBound = nameToI64(lowerBound, this.getNode());
							} catch (error: any) {
								throw new NodeOperationError(
									this.getNode(),
									`Failed to convert lower bound "${lowerBound}" to i64: ${error.message}`,
									{ itemIndex: i }
								);
							}
						}

						if (upperBound && !/^\d+$/.test(upperBound) && /^[a-z1-5.]{1,12}$/.test(upperBound)) {
							try {
								processedUpperBound = nameToI64(upperBound, this.getNode());
							} catch (error: any) {
								throw new NodeOperationError(
									this.getNode(),
									`Failed to convert upper bound "${upperBound}" to i64: ${error.message}`,
									{ itemIndex: i }
								);
							}
						}
					}

					// Add optional parameters
					if (processedLowerBound) queryParams.lower_bound = processedLowerBound;
					if (processedUpperBound) queryParams.upper_bound = processedUpperBound;
					if (keyType) queryParams.key_type = keyType;
					if (indexPosition >= 1) queryParams.index_position = indexPosition;

					// Execute the query
					const result = await rpc.get_table_rows(queryParams);

					returnData.push({
						json: {
							success: true,
							operation: 'getTable',
							contract: contractName,
							table: tableName,
							scope,
							queryParams,
							originalBounds: {
								lowerBound,
								upperBound,
							},
							convertedBounds: {
								lowerBound: processedLowerBound,
								upperBound: processedUpperBound,
							},
							autoConvert,
							rows: result.rows,
							more: result.more,
							next_key: result.next_key,
						},
					});
				}

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
					`WAX Smart Contract operation failed: ${error.message}`,
					{ itemIndex: i }
				);
			}
		}

		return [returnData];
	}
}
