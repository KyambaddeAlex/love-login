# Web push notification setup

This project uses Firebase Cloud Messaging for browser delivery and a Cloudflare Worker as the sender. The Worker can run on Cloudflare's free plan; Firebase Cloud Functions and a Firebase billing upgrade are not needed.

## 1. Configure Firebase Web Push

1. In Firebase Console, open **Project settings → Cloud Messaging → Web configuration**.
2. Generate a Web Push certificate key pair if one does not already exist.
3. Copy the public key into `PUSH_CONFIG.vapidKey` in `firebase-config.js`, replacing `SET_FIREBASE_WEB_PUSH_CERTIFICATE_KEY`.
4. In Firebase Console, open **Project settings → General** and copy the Web API key into `worker/wrangler.toml`, replacing `SET_FIREBASE_WEB_API_KEY`.
5. In Google Cloud Console for the same project, enable the **Firebase Cloud Messaging API**. Firebase Authentication's Identity Toolkit API must also be enabled for the Worker to validate sign-in tokens; it is normally enabled with Firebase Authentication.

The VAPID public key and Firebase Web API key are client configuration values. Never put a service-account private key in browser code.

## 2. Configure the app URL

The app must be opened from HTTPS in production, or from `http://localhost:5500` during local development. A `file://` URL does not support service workers.

In `worker/wrangler.toml`, set:

- `APP_ORIGIN` to the exact app origin, such as `https://your-site.web.app` (no trailing slash).
- `APP_URL` to the app base URL, such as `https://your-site.web.app/` (include the trailing slash).

Deploy the site to Firebase Hosting or another HTTPS static host if it is not already hosted.

## 3. Create a restricted service account

In Google Cloud Console, create a service account for the Worker and grant only the roles it needs:

- **Cloud Datastore User** to read the message and device-token documents.
- **Firebase Cloud Messaging API Admin** to send FCM notifications.

Create a JSON key for that account. Keep the key outside the website source and never commit it or share it in chat.

## 4. Deploy the Cloudflare Worker

Install Node.js, then in PowerShell from this project directory:

```powershell
npx wrangler login
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --config .\worker\wrangler.toml
npx wrangler deploy --config .\worker\wrangler.toml
```

When prompted for the secret value, paste the complete service-account JSON locally. Do not put it in `wrangler.toml`.

Copy the deployed Worker URL (for example `https://love-login-push.<your-account>.workers.dev`) into `PUSH_CONFIG.workerUrl` in `firebase-config.js`, replacing `SET_CLOUDFLARE_WORKER_URL`.

## 5. Deploy Firestore rules and test

Deploy the updated `firestore.rules` in Firebase Console or with Firebase CLI. Then reload each dashboard and press **Enable message alerts** on every browser/device that should receive notifications. The browser will ask for notification permission.

Send a test chat message in each direction. A recipient must enable alerts on each device; an unregistered device will not receive push notifications. The app also continues to show in-app notifications while open. The sender sees whether FCM accepted the alert for registered devices; browser delivery still depends on device connectivity and notification settings.

The Firebase service-account key is a powerful credential. If it is ever exposed, revoke it in Google Cloud Console immediately and create a replacement.
