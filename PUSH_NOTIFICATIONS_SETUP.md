# Push notifications, task reviews, rewards, and account deletion

Love Login uses Firebase Cloud Messaging for browser notifications and the
Cloudflare Worker in `worker/` for privileged operations. The Worker validates
Firebase ID tokens and uses its service account for task reviews, reward
transactions, and partner account deletion. The admin can delete girlfriend
accounts but cannot create them; partners use the existing sign-up flow.

## Worker configuration

The Worker configuration in `worker/wrangler.toml` contains the Firebase
project identifiers, public web API key, and allowed app URLs. Keep
`FIREBASE_SERVICE_ACCOUNT_JSON` as a Cloudflare secret; never add service
account credentials to the repository or browser code.

To deploy the Worker from PowerShell:

```powershell
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --config .\worker\wrangler.toml
npx wrangler deploy --config .\worker\wrangler.toml
```

The deployed Worker URL must match `PUSH_CONFIG.workerUrl` in
`firebase-config.js`. Its service account needs Firestore access and Firebase
Authentication Admin permissions to delete accounts. The Worker is restricted
to the configured app origin and the existing admin UID.

## Firestore rules

Publish `firestore.rules` after changing authorization behavior. Client-side
users cannot write point history or reward requests, edit reward balances, or
delete account profiles. The Worker performs task awards and reward debits or
refunds in Firestore transactions, preventing duplicate awards and overspending.
Partner deletion is performed by the Worker and removes only that partner's
authentication account and related records.

## Push notifications and read receipts

The recipient must enable alerts on each device that should receive messages.
Messages start unread; the recipient's visible chat marks received messages as
read, and the sender sees **Unread** or **Seen**. Shared devices registered to
both sender and recipient are excluded from push delivery.

## Install Love Login

- **iPhone/iPad:** Open the secure site in Safari, tap **Share → Add to Home
  Screen**, and launch the installed app. Web push requires iOS/iPadOS 16.4 or
  later.
- **Android:** Open the site in Chrome and choose **Install app** (or use
  Chrome's menu).

Account data, messaging, and notification delivery require an internet
connection.
