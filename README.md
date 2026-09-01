# CoinLens

## Expo Backend URL

For local Expo runs, copy `.env.example` to `.env.local` and set the backend URL:

```env
EXPO_PUBLIC_API_BASE_URL=https://YOUR-SERVICE.onrender.com
```

Then restart Expo with a clean cache:

```sh
npx expo start -c
```

For EAS builds, set `EXPO_PUBLIC_API_BASE_URL` in the EAS environment for the build profile. `app.json` also has `expo.extra.apiBaseUrl` as a fallback, but environment variables are preferred so the deployed Flask URL is not hardcoded into source.

## Render Mock Mode

In Render, set `MOCK_MODE=true` for a keyless mock deployment. With mock mode on, the Flask API returns deterministic canned data containing `MOCK RESPONSE FROM RENDER FLASK SERVER` and does not call OpenAI, Numista, PCGS, or SheetDB.
