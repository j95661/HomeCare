# HammondCare

Private family care app for a small team. Each person has their own sign-in. New people use Gmail or an email code, so nobody has to invent a starting password. The super admin keeps an email and password. Care data lives in Firestore and is allowed only by security rules.

## Decisions locked for this build

- **Super admin email** is chosen when you bootstrap the project. Set `SUPER_ADMIN_EMAIL`. Exactly one protected account is created. Nobody, including other admins, can demote or revoke it. The app does not hardcode a personal address.
- **Team lead** is a real role on day one. Team leads manage the schedule and shift swaps and can read the full medication log. They cannot edit medications or guides, and they cannot revoke anyone.

## Roles

| | Super admin | Admin | Team lead | Care provider |
| --- | --- | --- | --- | --- |
| Create, edit, and revoke accounts | Yes, except the super admin | No | No | No |
| Medications and how-to guides | Edit | Edit | Read | Read |
| Schedule | Edit | Edit | Edit | Read, request coverage |
| Medication log | Full | Full | Full | Own responses only, written by the server |
| Handover notes, activities, messages | Yes | Yes | Yes | Yes |
| App settings | Yes | No | No | No |

Parents use their own admin accounts. Revocation runs through the `revokeUserAccount` Cloud Function: the profile is marked inactive first (so an existing sign-in token fails every security rule immediately), the Auth user is disabled, refresh tokens are revoked, and that user's devices are unsubscribed from push and deleted.

## What the app does

1. Pinned handover notes on the home screen.
2. Day, week, and month schedule. A care provider can request a swap or a day off. Someone else accepts, and the shift moves to them. The request keeps who asked, who accepted, and when.
3. Medications with dose, frequency, times, and care notes. Reminders are visible and audible, and only go to people marked on shift. The prompt is Given, Declined, Missed, or Snooze. Every response is logged.
4. On-shift / off-shift toggle. Off shift stops medication reminders for that person only. Messages and coverage requests still notify them.
5. Activities for things to do with Andrew. Anyone on the team can add or update. Admins can remove.
6. One group thread and one-to-one threads.
7. Admin-managed how-to guides.

Each person can set an emoji on More. Teammates see it next to that person's name. Each person can also choose a color scheme there. That choice changes only their screen. People who have not chosen one see the team scheme from Settings. When the super admin adds a person, they choose Gmail or Email code. Gmail writes an invite and creates the account the first time that Gmail address signs in. Email code creates the account with no password; each sign-in sends a 6-digit code. Password changes stay on a schedule for password accounts only, including the super admin. The default is 183 days (about six months). The super admin can change that interval in Settings. The care-home clock defaults to America/Los_Angeles, and the super admin can change that timezone in Settings too. Settings holds the team color scheme: Forest, Night, Ocean, or Clay. That scheme is the default for anyone who has not picked their own. A password account still confirms the email with a 6-digit code on first sign-in.

## Install on a phone

The manifest uses `display: "standalone"`. Add the site to the Home Screen, then open it from that icon.

On iPhone, push works on iOS 16.4 or later, and only from the Home Screen app. The Enable notifications button refuses to run in a normal browser tab. Tap it after you have opened HammondCare from the icon.

## Local emulators

```bash
npm install
npm --prefix functions install
npm --prefix functions run build
python3 scripts/make-icons.py
npm run dev
```

In another terminal:

```bash
npx firebase emulators:start --project demo-family-care
SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='choose-a-password1' npm run bootstrap -- --emulator
```

Add `SEED_DEMO=1` to also create sample people, a medication, today's shifts, a guide, an activity, and a handover note. Demo sign-ins use the same password:

- `parent@homecare.test` admin
- `lead@homecare.test` team lead
- `alex@homecare.test` and `sam@homecare.test` care providers

The first sign-in still asks for the email code. The emulator shows that code on the sign-in screen and in the Functions log. Production never returns the code to the browser.

Open http://127.0.0.1:5173.

## Production

The live project is [hammondcare-ce36f](https://console.firebase.google.com/project/hammondcare-ce36f/overview). The site is [hammondcare-ce36f.web.app](https://hammondcare-ce36f.web.app). `.firebaserc` deploys there. Local emulators stay on the `demo` alias (`demo-family-care`).

The web app is registered. Firestore is created in `nam5`. The public web config is in `.env.example`. Copy it to `.env.production` before a production build.

Cloud Functions and Authentication on this project require the Blaze plan. Turn on email/password (for the super admin) and Google (for Gmail people). Set `OTP_PEPPER`, `SUPER_ADMIN_EMAIL`, and `SUPER_ADMIN_PASSWORD`. Email codes need SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) on the functions. Gmail sign-in does not use SMTP. Until those SMTP values are set, an email-code sign-in returns “Email is not configured on the server.” `HOMECARE_WEB_API_KEY` must match the web API key so password changes can check the current password. Firebase rejects environment names that start with `FIREBASE_`.

```bash
npx firebase login
npx firebase use hammondcare-ce36f
npm run build
npx firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='choose-a-password1' npm run bootstrap
```

Generate a Web Push certificate in Firebase Console and set `VITE_FIREBASE_VAPID_KEY` before building, or the phone cannot subscribe.

The public Firebase config is not a secret. Security rules are the access control. Do not switch the rules to open test mode.

## Tests

```bash
npm test
```

`npm test` runs the logic suites, then the Firestore emulator rules suites. Logic covers roles, revocation order, OTP, the password window, on-shift medication fan-out, snooze grace, off-shift message delivery, shift acceptance, calendar dates, and the Home Screen push gate. Rules suites check that inactive, unverified, and expired accounts fail closed, and that clients cannot write logs, snoozes, devices, OTP challenges, or someone else's thread.
