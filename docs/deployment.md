# Deployment

This project is a standalone Git repository. Its GitHub repository is `survivormal/lastz-map-planner`. The deployment target is Northflank team **LastZ**, project **Map Planner**, service **lastz-map-planner**. The service uses the root Dockerfile and release branch `main`. No runtime secrets are required.

## Runtime

The app uses SolidStart 2 with Vite and Nitro's `node_server` preset. Use Node.js 24 or newer. `npm ci` installs the locked dependencies; `npm run build` creates a standalone `.output` directory. Production runs with `node .output/server/index.mjs`, not Vite's preview server.

The Dockerfile builds, type-checks, and tests the project, then runs the generated server as the non-root `node` user. It listens on port 3000 and binds to `0.0.0.0`. `PORT` and `HOST` can override those defaults. `GET /api/health` is the readiness endpoint.

Local container verification:

```sh
docker build -t lastz-map-planner .
docker run --rm -p 3000:3000 lastz-map-planner
```

Open `http://localhost:3000` and check `http://localhost:3000/api/health`.

## GitHub and Northflank

1. Connect the GitHub repository `survivormal/lastz-map-planner` (release branch `main`). Keep the research workspace and private game captures outside the planner repository.
2. Connect that repository in Northflank. Create a service using the repository's root `Dockerfile` and root build context.
3. Expose container port 3000 as HTTP. Use `/api/health` for the health check. Set `NODE_ENV=production`, `HOST=0.0.0.0`, and `PORT=3000` if runtime overrides are needed.
4. Configure automatic builds/deployments for the chosen release branch. Northflank can also create isolated previews for pull requests.
5. Make the GitHub `Validate planner / check` result a required branch check. It runs clean installation, TypeScript checks, domain tests, and the production build.
6. Verify placement editing, save/reload, JSON import/export, clipboard access over HTTPS, and server validation on the deployed URL before sharing it.

Northflank can host the full SolidStart Node application. Supabase is optional infrastructure for future account management, shared-plan persistence, storage, and realtime collaboration. It is not a drop-in replacement for this Node container. No Supabase keys are required by the current app.

## Persistence and privacy

Plans currently stay in browser local storage. JSON exports are portable backups; CSV exports are assignments. Local storage belongs to the browser and origin: switching hostnames, clearing browser data, or changing browser profiles does not transfer plans. Export plans before changing deployment domains.

The stateless `POST /api/validate` endpoint accepts a JSON plan up to 2 MiB and checks its schema; it does not store a plan, contact the game, or prove that assumptions match current game rules. Hosting this endpoint does not create collaborative persistence.

Keep credentials in the hosting provider's secret settings. Never commit `.env` files or access tokens. A future Supabase integration should use per-user access policies, and privileged keys must remain on the server.

## Source references

- [SolidStart deployment plugins](https://docs.solidjs.com/solid-start/v2/guides/deployment-plugins)
- [Nitro Node runtime](https://nitro.build/deploy/runtimes/node)
- [Northflank application ports](https://northflank.com/docs/v1/application/network/expose-your-application)
- [Northflank environments and Git triggers](https://northflank.com/docs/v1/application/getting-started/set-up-environments)
- [Supabase backend products](https://supabase.com/docs)

Dependency versions were verified on November 5, 2026. SolidStart 2 is stable; its selected Nitro 3 integration currently uses a pinned release candidate, so runtime upgrades should repeat the build and deployment smoke checks.
