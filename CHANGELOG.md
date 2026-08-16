# Changelog

## 0.2.1

Fixes from an adversarial review of 0.2.0. No API changes.

### A failed batch no longer discards the transfers that already went out

`Wax Transfer NFT` and `Wax Transfer Token` looped over items with no per-item
handling, so a failure on item three threw away the transaction ids of items one
and two — which were already broadcast and irreversible. A workflow retried from
the start sent them again, moving real assets twice. Successes are now returned
either way, and the error says how many went out.

### "Not found" no longer means "we could not look"

`ensureAuthorized` swallowed every failure — timeout, 500, DNS — and reported
`Collection "x" not found`. A workflow branching on absence, the natural shape
being "template missing, so create it", took the wrong path during an endpoint
blip. Only a 404 reports absence now.

### A balance read with no symbol is an error, not zero

The match for a cleared symbol was a lone trailing space, which finds nothing,
so the fallback reported `0`. A workflow gating on a balance read an unknown as
an empty account. It now refuses, because an account may hold several balances
and there is no single number to give.

### Documentation that was wrong

- The README named a credential field **Chain** with two values. It is
  **Network**, with four, and it defaults to no check — on new credentials as
  well as upgraded ones. The guard protected nothing until you chose, and the
  docs implied otherwise.
- `RELEASING.md` said one set decides https enforcement. There are four
  mechanisms across four files; following the old instruction would have sent
  someone adding a token operation to edit the wrong file.
- The 0.2.0 entry claimed an operation missing from that set lost both https and
  the chain check. Only https: the chain check lives in `createSigningApi` and
  covers anything that signs.
- The security note described a hostile endpoint as able to *observe* what you
  sign. It can also **change** it: ABIs are fetched from that same endpoint at
  signing time and only the chain ID is pinned.

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

- All signing paths route through one factory, `createSigningApi`, so the chain
  check cannot be bypassed by adding an operation and forgetting about it.
  **https enforcement is separate and is not centralised** — four files decide
  it independently, and an operation missed there still signs, just over http.
  See `RELEASING.md`. An earlier draft of this entry claimed a missing operation
  lost both checks; only https is at risk.
- Endpoints for signing operations must be https.

## 0.1.18 and earlier

See the git history.
