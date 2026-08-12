# Security hardening — steps only you can do

I've made the code-side fixes (XSS-safe rendering, consistent IC column
handling + masking, App Check wiring, `firestore.rules` draft). The rest
requires access to your Google/Firebase account, so it's on you. None of
this needs a login screen for your team — App Check works invisibly.

## Why this matters

Your Firebase project (`shilaamzah-95e3a`) currently has no auth and the
repo is public on GitHub, so right now anyone who finds the repo (or
opens browser devtools on the live site) has the project config needed to
read/write your Firestore data directly — including the IC number field —
without ever touching your app's UI. The Firebase API key itself being
public is normal (Google designs it that way); what's missing is a real
gate, which is what the steps below add.

## 1. Register a reCAPTCHA v3 site key (2 min)

1. Go to https://www.google.com/recaptcha/admin/create
2. Choose **reCAPTCHA v3**.
3. Add the domain(s) your site is actually served from (e.g. your GitHub
   Pages domain, custom domain, or `localhost` for testing).
4. Copy the **Site key**.

## 2. Enable App Check in Firebase (3 min)

1. Firebase console → your project → **App Check**.
2. Register your web app, provider = **reCAPTCHA v3**, paste the site key
   from step 1.
3. Don't enable "Enforce" yet — do that in step 5, after you confirm the
   app still loads with App Check active (otherwise you can lock
   yourself out of your own data).

## 3. Paste the site key into the app

Open `js/firebase-config.js` and set:
```js
window.recaptchaSiteKey = "PASTE_YOUR_SITE_KEY_HERE";
```
Commit and deploy this. Reload the live site, open devtools → Console,
and confirm you don't see the "App Check not activated" warning and data
still loads normally.

## 4. Publish the Firestore rules

Copy the contents of `firestore.rules` (already written in this repo)
into Firebase console → **Firestore Database → Rules**, and publish.
(Or, if you use the Firebase CLI: `firebase deploy --only firestore:rules`.)

This changes the rules from whatever they are now (likely open/test-mode)
to: only requests carrying a valid App Check token can touch the
`app/state` document, and everything else is denied by default.

## 5. Turn on enforcement

Once step 3 and 4 are live and you've confirmed the app still works:
Firebase console → **App Check** → find "Cloud Firestore" → **Enforce**.

This is the real switch — it rejects any Firestore request without a
valid App Check token at the infrastructure level, even if the rules
above were ever misconfigured later.

## 6. Defense in depth: restrict the API key (optional but recommended)

Google Cloud Console → **APIs & Services → Credentials** → find the
Firebase browser key → **Application restrictions → HTTP referrers** →
add your site's domain(s). This stops the key being usable from random
scripts/servers even before App Check is checked.

## 7. Repo visibility

The repo is currently public, so the old Firebase config has been visible
in git history regardless of what `.gitignore` says. That's fine *once*
steps 1–5 are done, since the key itself isn't the secret — the rules and
App Check are. If you'd still rather not have the config in history, the
options are: make the repo private, or rewrite history with
`git filter-repo`/BFG (this rewrites commit hashes and requires a
force-push — tell me if you want this and I'll walk you through it
carefully, since it's disruptive to anyone else with a clone).

## 8. Sanity check after enforcing

- Reload the live site normally → should still load/save data.
- Try loading `https://YOUR_SITE/` in an incognito window → should also
  work (App Check runs per-page-load, not per-login).
- Optional: try hitting the Firestore REST API directly with `curl` using
  the config from the old commit → should now get a permission error.
