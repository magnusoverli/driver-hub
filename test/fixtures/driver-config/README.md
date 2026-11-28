# Shared driver-config cases

Copied unchanged from the VideoIPath External Drivers repository, `Drivers/schemas/tests/`, at commit `183e1f0d41d7` (PR #25). They are the agreed contract for `driver-config.json` schemaVersion 2: which declarations are valid, and which reason codes each effective value produces. `test/driver-config-contract.test.js` runs every case against Hub's own validator.

To update, copy both files from the repository again and run `npm test`. Hub keeps its released code `out_of_range` for integers; the test reads it as the contract's `below_minimum` or `above_maximum`.
