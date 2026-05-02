# n8n-nodes-wax

This is an n8n community node. It lets you use the WAX Blockchain in your n8n workflows.

The WAX Blockchain is a purpose-built blockchain and protocol token designed to make e-commerce transactions faster, easier, and safer for all participants. It's specifically designed for the transfer of digital assets, including NFTs (Non-Fungible Tokens).

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/about/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)  
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

This node package provides the following operations for interacting with the WAX Blockchain:

- **Get Account Info**: Fetch detailed account information from the WAX blockchain
- **Get Assets**: Retrieve NFT assets owned by an account, with optional filtering by template ID, collection, or schema
- **Get Account Token Balance**: Get token balance for an account
- **Mint Asset**: Mint a new AtomicAssets NFT from an existing template
- **Create Template**: Create a new AtomicAssets template under a collection and schema
- **Get Schema Format**: Retrieve a schema's field definitions (useful for discovering what to put in Immutable/Mutable Data when minting)
- **Transfer Assets**: Transfer NFT assets from one account to another
- **Transfer Tokens**: Transfer tokens (e.g., WAX) from one account to another
- **Verify Account**: Verify if an account exists on the WAX blockchain
- **Buy RAM**: Purchase RAM resources for an account on the WAX blockchain
- **Stake CPU**: Stake WAX tokens for CPU resources on the blockchain
- **Stake NET**: Stake WAX tokens for network bandwidth resources on the blockchain

## Credentials

For operations that require signing transactions (Transfer Tokens, Transfer Assets, Buy RAM, Stake CPU, and Stake NET), you'll need to provide:

- **Account Name**: Your WAX account name
- **Private Key**: The private key associated with your WAX account

To obtain a WAX account and private key:
1. Create a WAX account through services like [WAX Cloud Wallet](https://wallet.wax.io/)
2. Export or generate your private key (keep this secure and never share it)

For read-only operations, no credentials are required, but you'll need to specify the account name as a parameter.

## Compatibility

This node requires n8n version 1.0.0 or later.

## Security considerations

The credential's private key gives **full control of the WAX account**. The
nodes are designed to keep the key inside n8n's credential store, but a few
configuration choices materially affect that:

- **API Endpoint.** Signed transactions are broadcast through the endpoint you
  configure. Pointing it at an attacker-controlled RPC node lets that node see
  every signed transaction this account produces. The nodes validate the URL
  shape (rejects raw IPs, embedded credentials, and known cloud-metadata
  hostnames) and require `https://` for any operation that signs, but they do
  **not** resolve DNS to verify the IP — DNS-rebinding to an internal address
  is possible for a determined attacker. Only use trusted RPC endpoints.
- **Token Contract / Contract field.** For Transfer Tokens and Transfer Assets,
  the `Contract` parameter is the EOSIO contract whose `transfer` action gets
  signed under your `active` permission. If you bind this field to upstream
  data (via an n8n expression sourced from outside the workflow), an attacker
  who can influence that data can swap `eosio.token` for an arbitrary contract
  whose `transfer` action does something destructive. **Pin this field to a
  literal value** (e.g., `eosio.token`, `atomicassets`) unless you fully trust
  the upstream source.
- **continueOnFail output.** When the node is configured with "Continue On
  Fail", error messages are sanitized to redact strings that look like keys or
  signatures, but you should still treat any error blob as untrusted before
  forwarding it to a downstream system (Slack, email, etc.).

## Usage

### API Endpoints

All nodes allow you to specify the API endpoint to use. The default is `https://wax.greymass.com`, but you can use any WAX RPC endpoint, such as:
- https://wax.greymass.com
- https://wax.cryptolions.io
- https://wax.dapplica.io

### Working with NFTs

When using Transfer Assets operation, you'll need to provide:
- The recipient account name
- Asset IDs (comma-separated list)
- Contract (defaults to "atomicassets")

You can use the Get Assets operation to find the asset IDs of NFTs owned by an account.

### Minting NFTs

Both **Mint Asset** and **Create Template** operate on the AtomicAssets contract and require the credential's account to be in the target collection's `authorized_accounts` list. If it isn't, the node fails fast with a clear error before any signature is produced - the collection's author can add it via `atomicassets::addcolauth`.

**Create Template** registers a new template in a collection under a specific schema. You provide:
- Collection Name
- Schema Name
- Transferable / Burnable flags
- Max Supply (`0` = unlimited)
- Immutable Data: a JSON object whose keys/types match the schema's format (e.g., `{"name":"Sword","power":42}`)

**Mint Asset** mints one NFT from an existing template. You provide:
- Collection Name
- Template ID (the schema is derived from the template - no need to specify it twice)
- New Asset Owner (recipient account)
- Optional Immutable Data Override / Mutable Data (JSON, validated against the schema)
- Optional **Back with Assets**: comma-separated EOSIO asset strings (e.g., `1.00000000 WAX`) to back the new NFT with

If you don't know what fields the schema expects, run **Get Schema Format** first - it returns the schema's field definitions so you know what keys/types to put in the Data fields.

### Token Operations

For Transfer Tokens and Get Account Token Balance operations, you can specify:
- Token contract (defaults to "eosio.token" for WAX)
- Token symbol (defaults to "WAX")
- Precision (number of decimal places, defaults to 8)

### Resource Management Operations

The WAX blockchain requires resources (RAM, CPU, and NET) to perform actions:

For Buy RAM operation:
- Specify the account that will receive the RAM
- Specify the amount of WAX to spend on RAM

For Stake CPU and Stake NET operations:
- Specify the account that will receive the staked resources
- Specify the amount of WAX to stake
- Option to transfer ownership of staked resources to the recipient account (when enabled, the recipient account gains control of the staked tokens)

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [WAX Developer Portal](https://docs.wax.io/)
* [WAX Blockchain GitHub](https://github.com/worldwide-asset-exchange/wax-blockchain)
* [EOS Network Documentation](https://docs.eosnetwork.com/)

## Version history

### 0.1.7
- Hide deprecated nodes from the UI search but keep them for backward compatibility for existing workflows

### 0.1.6
- Refactored terminology: renamed NFT to Asset throughout the codebase
- Enhanced token balance options for improved clarity and consistency
- Combined assets and NFTs functionality for better integration
- Improved WAX operations with new functionalities and credential management
- Refined account verification logic and simplified output handling
- Restructured codebase with resource operations extracted into separate files

### 0.1.5
- Initial public release
- Support for basic WAX blockchain operations
- NFT and token transfer capabilities
