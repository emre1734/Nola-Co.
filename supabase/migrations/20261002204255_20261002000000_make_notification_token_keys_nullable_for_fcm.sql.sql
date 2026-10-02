/*
# Make notification_tokens keys nullable for FCM support

## Why
The notification_tokens table was designed for Web Push (VAPID) which
requires p256dh_key and auth_key for payload encryption. Native Android
FCM tokens do not have these keys — they are a single registration token
string. The existing NOT NULL constraints prevent storing FCM tokens.

## Changes
1. Alter `notification_tokens.p256dh_key` from NOT NULL to NULLABLE.
2. Alter `notification_tokens.auth_key` from NOT NULL to NULLABLE.
3. Add a partial unique constraint on (user_id, endpoint) WHERE platform
   = 'android' is NOT needed — the existing UNIQUE(user_id, endpoint)
   already covers FCM tokens because the FCM token itself is stored in the
   `endpoint` column and is unique per device.

## Security
- No RLS policy changes. Existing owner-scoped CRUD policies remain valid.
- No new policies needed. The existing policies on notification_tokens
   already cover all platforms.

## Important Notes
1. Existing web push tokens are unaffected — they still have non-null
   p256dh_key and auth_key values.
2. FCM tokens will be stored with platform='android', endpoint=<FCM token>,
   p256dh_key=NULL, auth_key=NULL.
3. The UNIQUE(user_id, endpoint) constraint naturally prevents duplicate
   FCM tokens for the same user. Token refresh replaces the old endpoint
   via upsert.
*/

ALTER TABLE notification_tokens ALTER COLUMN p256dh_key DROP NOT NULL;
ALTER TABLE notification_tokens ALTER COLUMN auth_key DROP NOT NULL;
