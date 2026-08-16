# Releasing

## Before publishing

**Merge the branch.** Work has been landing on
`feat/create-account-and-chain-guard`. Publishing from a branch produces a
package whose source nobody can find from `main`.

**Bump the version.** npm refuses a republish of an existing version, so
forgetting this fails loudly — but bumping without writing down what changed
leaves users to diff the tarball. Update `CHANGELOG.md` in the same commit.

**Build and check what actually ships.**

    npm run build
    npm pack --dry-run

The published tarball contains `dist/`, not `nodes/`. A build that silently did
not run publishes the previous version's code under a new version number:

    grep -rl "sendAction" dist/     # or whatever the release adds

**Install it somewhere real before publishing.** `npm pack` produces a tarball
you can install into a live n8n:

    npm pack
    cd ~/.n8n/nodes && npm install /path/to/n8n-nodes-wax-0.2.0.tgz

It must go in `~/.n8n/nodes` and not `~/.n8n/custom` — the custom directory
renames node types to `CUSTOM.<name>`, so any workflow referencing
`n8n-nodes-wax.wax` imports as an unrecognised node with no indication why.

Restart n8n and confirm the new operations appear:

    curl -s -b cookie http://127.0.0.1:5678/types/nodes.json \
      | python3 -c "import json,sys; print([o['value'] for n in json.load(sys.stdin) if n['name']=='n8n-nodes-wax.wax' for p in n['properties'] if p['name']=='operation' for o in p.get('options',[])])"

## What deserves a second look

**`Send Action` is unconstrained and untested.** It can call any action on any
contract with the credential's key. During development it shipped twice broken:
once missing from `SIGNING_OPERATIONS`, so https was not enforced and the chain
guard never ran — on the one operation that can do anything — and once assuming
the actor equals the credential's account, which fails against any contract
expecting a different one.

It is the widest-reaching thing in this package and has no tests. Anything
touching it warrants reading the diff rather than the description.

**Adding a signing operation means telling https enforcement about it — and
there are four separate places that decide, not one.**

| File | How it decides |
|---|---|
| `nodes/Wax/resources/account.ts` | a `SIGNING_OPERATIONS` set |
| `nodes/Wax/resources/token.ts` | a *second*, separate `SIGNING_OPERATIONS` set |
| `nodes/Wax/resources/asset.ts` | an inline `operation === …` boolean |
| `nodes/Wax/resources/template.ts` | hardcoded `signing: true` |

Getting this wrong is quiet: the operation still works and still runs the chain
guard — that lives in `createSigningApi` and applies to anything that signs —
but https is no longer enforced on its endpoint. An earlier version of this file
named only `account.ts`, which would have sent someone adding a token operation
to edit the wrong file entirely.

## Publishing

    npm publish --access public

`prepublishOnly` runs the build and lint.

## After

Tag the release and push the tag, so the published version can be traced to a
commit:

    git tag v0.2.0 && git push origin v0.2.0
