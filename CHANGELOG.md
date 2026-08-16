# Changelog

## 0.2.0

Adds account creation, a generic contract call, and a guard against signing
against the wrong chain.

### Create Account

Creates a WAX account from two public keys, buying its RAM and staking its CPU
and NET in a single transaction. Written for onboarding flows where the server
holds the creator key and the player's keys never leave their device.

Two things worth knowing, both found the hard way:

- **A won name auction resources nothing.** `newaccount` on its own fails with
  `ram_usage_exceeded`; the RAM has to arrive in the same transaction, which is
  what this does.
- **Suffix accounts need two authorisations.** Only the owner of a suffix may
  create names under it, and that account may hold no funds — so the creator
  and the payer can be different accounts. This operation signs as one account;
  if yours are different, fund the suffix owner.

### Send Action

Calls any action on any contract, signed by the credential. Every other
operation models one specific thing, and contracts this node has never heard of
still need calling — the alternative being a workflow that keeps a private key
in a Code node to sign for itself, which defeats the point of credentials.

It takes an **Actor** separate from the credential's account name. A credential
holds a key; the same key may control several accounts, and a contract checking
`require_auth` for a specific one refuses anything else with `missing authority
of <account>` — naming the account it wanted, not the one that signed.

**This operation is unconstrained by design.** It will sign whatever it is
given. It has no tests.

### Chain guard

Every signing operation now verifies that its endpoint actually serves the
chain its credential names, and refuses if not. A testnet endpoint left behind
in a workflow otherwise signs real transactions against mainnet; the reverse
looks like nothing happening at all.

Existing credentials default to `unset`, which skips the check and preserves
the previous behaviour. **Upgrading breaks nothing, and also protects nothing
until the chain is set on each credential.**

### Also

- All signing paths route through one factory, so the guard cannot be bypassed
  by adding an operation and forgetting about it. `SIGNING_OPERATIONS` is the
  list; an operation missing from it enforces neither https nor the chain check.
  `Send Action` shipped missing from that list during development, which is
  precisely the failure the single factory exists to make unlikely.
- Endpoints for signing operations must be https.

## 0.1.18 and earlier

See the git history.
