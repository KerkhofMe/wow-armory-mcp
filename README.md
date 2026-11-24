# WoW Forever Armory MCP

A local, read-only MCP server for public [World of Warcraft: Forever](https://worldofwarcraft.blizzard.com/en-us/news/24315820/world-of-warcraft-forever-now-live) character profiles. It calls Blizzard's Battle.net Profile API using the Forever namespace (`profile-forever-<region>`); it doesn't scrape the Armory or fall back to Retail or Classic. No Battle.net player sign-in or account access is needed to look up characters. The Forever API routes are [community-documented by Pinta365](https://blizzard.pinta.land/forever/characters-and-guilds/) and may change.

## Set up

1. Sign in to the [Battle.net Developer Portal](https://community.developer.battle.net/access/clients) and choose **Create Client**. Give the app a name. If the form asks for a website or redirect URI, use a URL you control; the server does not use redirects.
2. Keep the **Client ID** and **Client Secret** in your MCP client's local secret settings. The server reads `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` from its environment. Do not commit credentials, paste them into chat, or put them in command arguments. The server uses the [OAuth client credentials flow](https://community.developer.battle.net/documentation/guides/using-oauth/client-credentials-flow) and keeps short-lived access tokens in memory.
3. Clone the repo:

   ```sh
   git clone https://github.com/KerkhofMe/wow-armory-mcp.git
   cd wow-armory-mcp
   ```

4. For a native install, build with Node.js 22 or newer and npm. To skip the local Node.js install, follow the [container instructions](#run-in-a-container) instead.

   ```sh
   npm ci
   npm run build
   ```

### Connect an MCP client

For **VS Code**, put this in your local `.vscode/mcp.json`. Replace the script path with the absolute path to the built file. If the editor cannot find `node`, use the absolute path to the Node.js executable as `command`.

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "blizzard-client-id",
      "description": "Battle.net app Client ID",
      "password": true
    },
    {
      "type": "promptString",
      "id": "blizzard-client-secret",
      "description": "Battle.net app Client Secret",
      "password": true
    }
  ],
  "servers": {
    "wow-armory": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/wow-armory-mcp/dist/index.js"],
      "env": {
        "BLIZZARD_CLIENT_ID": "${input:blizzard-client-id}",
        "BLIZZARD_CLIENT_SECRET": "${input:blizzard-client-secret}"
      }
    }
  }
}
```

In another MCP client, register the same `node` command and script argument as a **stdio** server and pass the two variables using the client's environment settings. The client launches the process; there is no HTTP listener. Launch `node` directly rather than `npm start` in the MCP configuration so npm's banner stays off the protocol stream.

### Run in a container

With Docker running, build the **WoW Forever** image from the repository root. No local Node.js installation is needed:

```sh
docker build -t wow-armory-mcp:local .
```

In the VS Code example above, keep `inputs` and the `env` block as written. Replace the server's `command` and `args` with:

```json
{
  "command": "docker",
  "args": [
    "run", "--rm", "-i",
    "--env", "BLIZZARD_CLIENT_ID",
    "--env", "BLIZZARD_CLIENT_SECRET",
    "wow-armory-mcp:local"
  ]
}
```

Other MCP clients can use the same command and arguments. If your client can't find `docker`, use the absolute path to the executable. Docker forwards the two environment variables from the client-launched process; don't put their values in the arguments or bake them into the image. Keep `-i` (open stdin) and don't add `-t` (allocate a terminal), so the MCP client can exchange messages over stdio. The container runs as a non-root user and needs outbound HTTPS to Battle.net, but no published ports.

**Updating from the older Retail build?** Rebuild using the same `wow-armory-mcp:local` tag, then stop and restart `wow-armory` in your MCP client. An already-running container doesn't pick up the new image. Your Battle.net credentials and Docker configuration stay the same; character lookups now use `name` and `surname` instead of `name` and `realm`.

## Look up a character

Every tool takes `region`, `name` (first name), and `surname`. For example, to find [Arthas Afterlife](https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/arthas-afterlife):

```json
{"region":"us","name":"Arthas","surname":"Afterlife"}
```

The full name is unique within a region. Don't pass a realm or ruleset: the summary returns the ruleset (such as Normal or PvP). Names are case-insensitive; keep accents and non-Latin characters as written in-game.

| Tool | Data |
|---|---|
| `wow_character_summary` | Level, ruleset, race, class, faction, guild, item levels, and achievement points when published |
| `wow_character_equipment` | Equipped items by slot, including item IDs, quality, and item levels |
| `wow_character_achievements` | Achievement totals and a page of completed achievements; optional `search` by name |
| `wow_character_collection` | A page of collected `mounts` or battle `pets` via `collection`; optional `search` by name |
| `wow_character_talents` | Active and alternate builds, points spent per tree, and ranks of learned talents |
| `wow_character_pvp` | PvP rank, honorable kills, and battleground results when available |

Achievements and collections accept `offset` (default `0`) and `limit` (default `25`, maximum `100`). Use the returned `next_offset` until it is `null`. `total` is the number of matching entries, not the page length. Achievement `total_quantity` and `total_points` are Blizzard's unfiltered totals. Pagination bounds tool output; Blizzard returns the collection in one upstream request per call.

Supported `region` values are `us` (Americas/Oceania), `eu` (Europe), `kr` (Korea), and `tw` (Taiwan). Labels use `en_US`, `en_GB`, `ko_KR`, and `zh_TW`, respectively. Mainland China is not supported; it requires a separately registered Battle.net API client. Public Battle.net profiles may not appear until a character reaches level 10 and logs out. A wrong name or region, a private profile, or data Blizzard hasn't published can also return `NOT_FOUND`. Data reflects the last published snapshot, not live gameplay. For `RATE_LIMITED`, wait before retrying; the tool reports Blizzard's retry delay when provided.

## Develop

`npm run build` compiles the TypeScript. `npm test` builds and runs the OAuth/client tests and the MCP integration tests. `npm run test:stdio` runs only the stdio integration tests, which launch the compiled server and exercise it with the official SDK client and a loopback mock of Battle.net. Tests do not require credentials or call the live Blizzard API.

After building the Docker image as described above, run `node --test test/container-smoke.mjs` with the development dependencies installed to check MCP startup and tool calls through Docker.
