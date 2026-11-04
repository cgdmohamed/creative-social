# Advertising campaign manager: execution and recovery

Open `/advertising`. This replaces the earlier Phase 4 draft-only boundary. Real provider transports are implemented; `ADVERTISING_WRITES_ENABLED=false` remains the operator default. Saving, duplicating, reviewing and approving drafts never submits them.

## Supported workflows

| Provider | Creation | Management |
| --- | --- | --- |
| Meta | Paused campaign → paused ad set → image/video creative → paused ad; add an ad set/ad to an existing owned parent | Campaign/ad-set/ad pause/resume; campaign name/daily budget; ad-set name/daily budget/end/targeting/bid; ad name/creative replacement; native deep copy with paused status verification |
| Google | Atomic paused Search campaign, dedicated daily budget, paused Search group and responsive search ad; add groups/ads to existing Search parents | Campaign/group/ad status; campaign name/daily budget/end/bidding/country targeting; group name/manual CPC/positive and negative keywords; unshared responsive search ad text/final URLs |

Meta objectives: traffic/link clicks, awareness/reach, Page post engagement, website leads (`LEAD` Pixel event), website sales (`PURCHASE` Pixel event), app installs (authorized application and matching official app-store URL). Pixel/Page/image ownership is checked with the selected account. App authorization, objective eligibility and optimization constraints remain provider validated. Automatic placements or Facebook Feed are supported. These are specific workflows for six objective enums, not every destination supported under those objectives.

Meta bids: lowest cost without cap, bid cap, cost cap (eligibility depends on objective/account). Google bids: manual CPC, maximize clicks, maximize conversions, target CPA, maximize conversion value and target ROAS. Portfolio strategy management is not supported. Conversion-based bidding requires operator-configured conversion goals. Exact Decimal currency units and Google micros are used; daily budgets are not lifetime spend caps. Shared Google budget changes require explicit acknowledgement and include every affected campaign in the immutable confirmation.

Google country targeting resolves official geo target constants and uses presence targeting. Existing negative geographic exclusions are preserved. Positive/negative keyword replacements are separately selected and preserve unchanged criteria. Google Search no longer accepts manual language targeting after September 2026: ad language/user signals determine matching. Legacy draft selections must be removed and reviewed again. Existing provider language records are preserved. See [Google criteria](https://developers.google.com/google-ads/api/docs/targeting/criteria) and [deprecations](https://developers.google.com/google-ads/api/docs/deprecations).

Google campaign dates are account-local calendar days, with an inclusive end date. Meta uses UTC timestamps. New budget-owning resources support immediate start and ongoing daily budgets, while remaining paused at creation. Child resources inherit appropriate parent budget/schedule/strategy; final review fetches actual budget owners instead of presenting draft values as existing budgets.

The Creative Library supports owned workspace Media and direct PNG/JPEG/WebP/MP4 uploads (50 MiB; Google images 5 MiB). Meta video processing must reach ready with a trusted thumbnail before use. Existing Meta image hashes/videos can be imported. Google image upload/import and asset association discovery are supported; Search RSA text assets are embedded in the ad. Uploading a standalone Google image does not attach it to a campaign. Binary Google video upload is unsupported (Google uses YouTube references). Files use configured local/R2 storage only; arbitrary remote URLs are not fetched.

## Authorization and execution

1. Authorize **management** explicitly in Settings → Advertising Accounts. Existing read-only connections are not silently upgraded. Reconnect/reselect accounts; a new consent epoch invalidates stale reviews, while routine token refresh does not.
2. An ADMIN/SUPERADMIN creates a revisioned workspace draft, selects fields to change and requests review. The snapshot records account, currency, schedule, actual budget owners/shared campaigns, source resource and canonical request digest.
3. SUPERADMIN may validate without mutation. Google validates the complete atomic batch. Meta initial validation covers the first resource; later resources validate when confirmed parent IDs exist. Creative validity/policy still requires provider acceptance.
4. SUPERADMIN types the exact phrase to approve. Approval expires after 15 minutes and is separate from execution.
5. With the operator flag enabled, submission requires a second typed phrase, explicit authorization checkbox and final browser confirmation. Backend independently checks membership, tenant/account/consent epoch, digest, expiry, current financial context and provider permissions.
6. Each mutation is durably marked SENDING and audited before transport. Returned IDs and sanitized outcomes commit atomically. Google uses `partialFailure:false`; Meta retains confirmed parents across child failure. New resources are requested PAUSED. A confirmed API result is not evidence of policy approval, billing eligibility or delivery.

There is no background campaign submission, automatic campaign activation, unknown-outcome retry, or provider deletion. Read/list requests use bounded pagination and explicitly fail on overflow (20,000 Google rows; 2,000 Meta resources per collection); narrow/manage large accounts in the provider UI if the supported bound is exceeded. Arbitrary provider JSON and arbitrary API URLs are not accepted.

## Failure recovery

- **CONFIRMED**: provider evidence recorded. Refresh lists/status and use the analytics link. Repeating the same submission returns its ledger and never replays mutations.
- **NO_CHANGE**: fresh reads already matched requested settings. No mutation was sent.
- **REJECTED**: definite rejection or preflight failure. Inspect field/error codes, permissions and cooldown. Explicit recovery uses the full confirmation plus `RECOVER <execution-id>`. Confirmed parents are retained. To change a specification, abandon remaining rejected steps with `ABANDON <execution-id>`, then create a new child/change draft referencing retained IDs.
- **UNKNOWN/SENDING**: transport timeout, malformed/5xx response or failed result persistence does not prove failure. Never create another campaign to compensate. Use **Reconcile provider outcome** after the active lease expires. Unique execution markers, account/parent ownership and requested settings are read back. Optional numeric Meta IDs must be verified in the provider UI first and are rechecked server-side. Native copy verifies paused children/counts. No evidence or ambiguous evidence leaves UNKNOWN and blocks unsafe retries. Escalate to the provider/operator rather than editing the database to reset the ledger.
- Rate limiting uses provider cooldowns; no automatic write retry. Revoked grants disable account use and require reconnection. Report/credential epochs prevent cross-connection writes.
- Safe rollback is a separately reviewed pause/update draft. Abandonment never deletes or enables retained provider resources. There is no reliable automatic destructive rollback across Meta steps.

## Explicit provider limitations

Meta instant forms, catalogs/shops/dynamic creative, Advantage+ workflows, special-ad-category/political advertising, custom/lookalike/interest audiences, arbitrary age/gender/placement combinations, policy appeals and cross-account cloning are not offered. Google campaign creation is Search only; Performance Max/Display/Video/Shopping/Demand Gen/app creation, portfolio strategy management, conversion-goal edits, asset-extension association mutations, arbitrary audience/exclusion editing and intraday ad scheduling are not offered. Existing non-Search campaigns may be discovered; creation controls never imply those workflows are supported. Providers decide eligibility, policy review and billing/delivery. No live provider operation has been validated by this release's automated tests.

See [release acceptance and real-account checklist](RELEASE_ACCEPTANCE.md), [advertising OAuth setup](ADVERTISING_ACCOUNTS.md), [paid reporting](PAID_ANALYTICS.md) and [production configuration](PRODUCTION_COOLIFY.md).
