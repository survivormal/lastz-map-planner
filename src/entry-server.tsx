import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#111919" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <meta
            name="description"
            content="Plan Last Z SVS formations on a full-scale hex map. Place HQs, define strategies, fill wedges, and share assignments."
          />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
