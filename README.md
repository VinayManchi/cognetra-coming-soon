# Cognetra — Coming Soon Page

Premium coming soon page for cognetra.app

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in Vercel dashboard
3. Connect cognetra.app domain
4. Done — live in 60 seconds

## Files

- `index.html` — The coming soon page
- `vercel.json` — Vercel deployment config
- `api/waitlist/join.js` — Waitlist signup endpoint (double opt-in)
- `api/waitlist/confirm.js` — Email confirmation endpoint
- `waitlist.schema.sql` — Database schema
- `.env.example` — Required environment variables

## Features

- Animated neural orb (Processing Efficiency %)
- Email waitlist capture
- Obsidian Veil design system
- Mobile responsive
- Zero dependencies
- Free SSL via Vercel

## Waitlist setup

1. Create a Supabase project and run `waitlist.schema.sql`.
2. Add env vars from `.env.example` in Vercel project settings.
3. Verify your sender domain in Resend and set `RESEND_FROM`.
4. Deploy. The form in `index.html` posts to `/api/waitlist/join`.

Flow:
- User submits email + consent.
- API stores `pending` record and sends confirmation email.
- User confirms via secure token link.
- API marks record `confirmed` and sends welcome email.
