# Deploying to Vercel

The app is a static site (Vite build into `dist/`), so Vercel needs no server setup. `vercel.json` pins the build settings and cache headers:

- **Build:** `npm run build` (type-checks, then builds and generates the service worker). **Output:** `dist`.
- **`/sw.js`** is always revalidated so a new version is noticed promptly. **`/assets/*`** (hashed file names) is cached for a year.

## One-time setup (about 3 minutes)

1. Sign in at <https://vercel.com> (a free Hobby account is enough).
2. **Add New → Project → Import Git Repository**, pick `clydealegro/pickleball-match-app`. If it isn't listed, choose **Adjust GitHub App Permissions** and grant Vercel access to that repository.
3. **Project Name:** type `pikl`. The page shows the URL it will get: `pikl.vercel.app`. If the name is taken, Vercel says so; pick another (for example `pikl-app` or `pickle-matchmaker`). You can rename the project, or add a custom domain, later under **Settings → Domains**.
4. Leave **Framework Preset** as Vite and the build settings as detected (they match `vercel.json`). No environment variables are needed for this version.
5. Click **Deploy**. When it finishes, open the URL on your phone.

## Which branch is production

Vercel deploys the repository's **default branch** to production. Right now the only branch in the repo (and therefore the default) is `claude/pickleball-matchmaking-app-i4baca`, so that is what goes live, and every push to it redeploys. Pushes to any other branch get their own preview URL. When you want a conventional setup, create a `main` branch, make it the default in GitHub (**Settings → Branches**), and set **Settings → Git → Production Branch** in Vercel to `main`.

## Installing it on a phone

Open the site in the phone's browser, then use **Add to Home Screen** (iOS Safari: the Share button; Android Chrome: the install prompt or menu). After the first visit the app also works offline.

## Updating

Push to the production branch and Vercel redeploys. Phones that already have the app see a "A new version is ready" notice with a **Reload now** button; the page never reloads by itself, so a half-filled setup form is not lost.

## Deploying from the command line (optional)

```bash
npx vercel          # first run: log in and link the project, creates a preview deployment
npx vercel --prod   # deploy to production
```

## Coming with later plans

- Photos: `vercel.json` sends `Permissions-Policy: camera=(self)`, which limits camera use to this site. The camera button is a file input with `capture`, which hands off to the phone's own camera app and should not need the header. Task 10 of the photos plan confirms that on a phone.
- Supabase sync will need two environment variables (the project URL and the publishable key) added under **Settings → Environment Variables** in Vercel. The service-role key must never be added to the app.
