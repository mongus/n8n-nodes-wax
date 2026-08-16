import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WaxBlockchainApi implements ICredentialType {
	name = 'waxPrivateKeyApi';
	displayName = 'WAX Private Key API';
	documentationUrl = 'https://github.com/mongus/n8n-nodes-wax';
	properties: INodeProperties[] = [
		{
			displayName: 'Network',
			name: 'network',
			type: 'options',
			default: 'unset',
			options: [
				{ name: 'Not Set (No Chain Check)', value: 'unset' },
				{ name: 'WAX Mainnet', value: 'mainnet' },
				{ name: 'WAX Testnet', value: 'testnet' },
				{ name: 'Custom Chain', value: 'custom' },
			],
			description: 'Which chain this key belongs to. Set this: operations then refuse to sign if the API endpoint reports a different chain, so a testnet workflow cannot silently transact on mainnet. Left unset, no check is performed.',
		},
		{
			displayName: 'Expected Chain ID',
			name: 'expectedChainId',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					network: ['custom'],
				},
			},
			description: 'Chain ID to require for a custom chain. Leave empty to skip the check entirely — only do that if you understand the risk.',
		},
		{
			displayName: 'Account Name',
			name: 'account',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			default: '',
			typeOptions: {
				password: true,
			}
		},
	];
}
