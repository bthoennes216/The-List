# Household Sync draft

This is a separate, opt-in sync service for The List. It is not part of the existing AI Worker. The app on `main` continues to save locally until the sync service is configured and this branch is merged.

## What the first version does

- Creates a household with a randomly generated 256-bit code.
- Encrypts the entire saved app snapshot on the phone with AES-GCM before upload.
- Stores encrypted chunks in Cloudflare D1. The Worker never receives the household code or plaintext home data.
- Lets another phone enter the code, review the shared snapshot, and choose to replace its local data.
- Offers explicit **Sync this phone's changes** and **Load shared data** actions. There is no automatic background sync or record-by-record merging.
- Rejects a stale upload when another phone has changed the household. Keep a backup before replacing divergent local data.

Anyone with the household code can read and change the shared household. Store it privately. There is no account recovery or code rotation in this first version. The code is saved in browser storage on each connected phone.

## Cloudflare setup

1. Create a D1 database named `the-list-households` in the same Cloudflare account as the existing AI Worker.
2. Run `household-sync.sql` against that D1 database.
3. Create a **separate** Worker from `household-sync-worker.js`. Bind the database to it with the variable name `DB`. Do not replace the existing AI Worker.
4. Visit the new Worker's root URL. It should report `{"ok":true,"service":"The List household sync","configured":true}`.
5. In `index.html` on this branch, set `SYNC_URL` to that new Worker's exact HTTPS origin. Do not put API keys or household codes in the source file.
6. Test with two browser profiles using disposable project data: create a household, join from the second profile, upload a change, load it on the other, and confirm that a stale upload is rejected. Back up each profile before testing with real data.
7. Merge only after the tests pass. GitHub Pages will then show **More → Household Sync**.

For a command-line deployment, Cloudflare documents `wrangler d1 create`, `wrangler d1 execute --remote --file`, D1 bindings, and `wrangler deploy`. Use the database ID returned by your own account; it is intentionally absent from this repository.

## Limits and follow-up

The encrypted snapshot is divided into chunks below D1's 2 MB value limit. It supports up to twenty 700,000-character chunks. If photos make a household too large, the app reports an error and keeps the local data; photo storage should be moved to an object store before a broader release.

This is a two-phone manual sync prototype. A public version needs account recovery, invitation revocation, usage controls, reliable photo storage, and conflict handling that can merge independent edits.
