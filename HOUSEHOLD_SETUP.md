# The List: two-account household test

The existing Cloudflare AI Worker remains separate. Household sign-in and private data storage use a Supabase project. Nothing syncs until the homeowner signs in, creates or joins a household, reviews both copies, and taps Save.

## Set up the test service

1. Create a Supabase project. In Authentication → URL Configuration, use the exact The List URL shown in the phone browser as the Site URL and add that URL to allowed Redirect URLs.
2. Enable Email sign-in. The app sends a passwordless **magic link**, so no custom email template is required. Supabase's default email provider is restricted to project team member addresses; to send links to another person's ordinary email without making them a project administrator, configure a custom SMTP provider first. Do not invite a household member into the Supabase administration team just to test sharing.
3. In Storage, create a **private** bucket named `list-project-photos` (do not make it public).
4. Run `household-schema.sql` once in the SQL editor. It creates household membership, private photo access, and revision-checked writes. Do not run the unrelated old `feature/household-sync` Worker or SQL; that prototype has no individual sign-ins.
5. Put the project's URL and **publishable/anon client key** in `household.js` under `HOUSEHOLD_SUPABASE_URL` and `HOUSEHOLD_SUPABASE_PUBLISHABLE_KEY`. These are intended for browser use. Never put a service-role key, SMTP password, or Cloudflare secret in GitHub.
6. Confirm the first sign-in and one-phone dry run on a preview branch before merging into the public app.

## Test with two phones

1. Download backups on both phones under More → Backup before signing in.
2. Phone A: More → Household → sign in → Create our household. Review its phone data and save it to the household.
3. Give the invitation code privately to the second test account. Phone B: sign in with a different email → Join household. Review its current projects and the shared projects. Save the combined result, choosing which copy wins if both phones edited the same record.
4. Phone A: Review again and load the shared copy. Confirm projects, conversations, and photos from Phone B show up. Change a task and repeat the review on Phone B.
5. Make different changes to the same project on each phone, save on one, and check that the other phone must review the updated household. Check that a failed save leaves its phone data intact.
6. Sign out and confirm local projects remain visible. Sign back in and repeat the review.

This first version syncs when someone taps **Review phone and shared projects**. It does not automatically push changes in the background. Two edits to the same conversation need a deliberate choice; unique projects and conversations are combined. Keep downloaded backups while testing. Invite codes can be used by any signed-in account that has one; rotating and revoking invites is a follow-up before public rollout.
