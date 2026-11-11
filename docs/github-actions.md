# Building the apps in GitHub Actions

Two workflows live in `.github/workflows/`:

| Workflow | When it runs | What it does |
|---|---|---|
| `ci.yml` | every push to `main`, every pull request | ~300 tests (RLS leak sweep, ledger, fees, i18n), type-checks, web production build, and the **mobile checks** (type-check + bundle for Android and web) |
| `mobile-build.yml` | by hand (**Actions → mobile-build → Run workflow**) or when you push a tag like `mobile-v0.1.0` | builds an **installable Android APK**; optionally an iOS simulator build and a store-grade **EAS** build |

Nothing here deploys the website — hosting is a separate decision (see "Not covered").

## One-time setup

1. **Put the project on GitHub.** This folder is not a git repository yet:
   ```bash
   git init -b main
   git add -A
   git status            # check: no .env.local, no dev-logins.local.txt, no *.keystore in the list
   git commit -m "Initial import"
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   `.gitignore` already excludes secrets, generated native folders and scratch output. **Never commit the Supabase service-role key or the database password** — they live only in `apps/web/.env.local`.

2. **Add two repository secrets** (Settings → Secrets and variables → Actions → *New repository secret*):

   | Secret | Value |
   |---|---|
   |`EXPO_PUBLIC_SUPABASE_URL` | your project URL, e.g. `https://xxxx.supabase.co` |
   |`EXPO_PUBLIC_SUPABASE_ANON_KEY` | the **anon** (public) key. **Never the service-role key** — the app is a file anyone can unpack. |

   `ci.yml` needs no secrets (it uses placeholders, because it only checks that the code compiles).

## Getting an Android app (APK)

1. Actions → **mobile-build** → *Run workflow* (leave the boxes unticked) → *Run workflow*.
2. After ~15–25 minutes open the finished run → **Artifacts** → `school-android-apk` → download, unzip.
3. On an Android phone: open the `.apk` (allow "install unknown apps" for your browser/file manager once).

The APK is signed with the **debug key**: perfect for testers, **not accepted by the Play Store**. Each build gets a higher `versionCode` (the run number) so a newer build installs over an older one.

## Store builds and iOS (needs accounts)

- **iPhone apps need an Apple Developer account (US$99/year)** — there is no way around this for installing on a real device or TestFlight. Without one, the optional *iOS simulator* build only proves the iOS app compiles (it cannot be installed on a phone).
- **Google Play needs a Play Console account (US$25 once).**
- The simplest way to produce correctly signed store files is **EAS** (Expo's build service). Setup: create an Expo account, create an access token (expo.dev → Account settings → Access tokens), add it as the repository secret `EXPO_TOKEN`, then run **mobile-build** with *Also start a store-grade EAS build* ticked and the profile `preview` (installable APK/IPA for testers) or `production` (Play Store AAB / App Store IPA). EAS asks you to sign in to Apple/Google once, interactively, the first time — run `npx eas-cli build --platform all` on your own computer for that first run, then the workflow can repeat it.
- The EAS path is **configured but untested** from this repo (needs your Expo account).

## What has been verified, and what has not

Verified on a Windows machine before this was written: both workflow files pass the GitHub Actions schema validator; `npm ci` lockfiles are consistent (root and `apps/mobile`); the exact CI bundle command succeeds; `expo prebuild` generates the Android project, and the `versionCode` edit matches the generated file; the release build type uses the debug signing config (so the APK is installable).

**Not verified (needs a real run on GitHub):** the Gradle build itself (Android SDK/JDK are not on this machine), the iOS build, and EAS. If a run fails, open the failing step in the Actions log and send it over — the first real run of a native build commonly needs one small fix.

## Not covered

- **Website hosting/deploy** (Vercel or similar) and its environment variables (`NEXT_PUBLIC_*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, provider secrets).
- Scheduling the two background jobs (`/api/jobs/nightly`, `/api/jobs/outbox`) — they are plain HTTPS POSTs with a bearer secret, so a scheduled workflow or the host's cron can call them.
- App name, bundle id (`pk.example.school`) and icons are placeholders until the product name is decided; change them in `apps/mobile/app.json` and regenerate the artwork with `apps/web/scripts/make-icons.mjs`.
