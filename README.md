# WoW Armory MCP

A local, read-only MCP server for public World of Warcraft **Retail** character profiles. It uses Blizzard's [Battle.net Profile API](https://community.developer.battle.net/documentation/world-of-warcraft/profile-apis), not Armory website scraping. No Battle.net player sign-in or account access is needed to look up characters.

## Set up

1. Sign in to the [Battle.net Developer Portal](https://community.developer.battle.net/access/clients) and choose **Create Client**. Give the app a name. If the form asks for a website or redirect URI, use a URL you control; the server does not use redirects.
2. Keep the **Client ID** and **Client Secret** in your MCP client's local secret settings. The server reads `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` from its environment. Do not commit credentials, paste them into chat, or put them in command arguments. The server uses the [OAuth client credentials flow](https://community.developer.battle.net/documentation/guides/using-oauth/client-credentials-flow) and keeps short-lived access tokens in memory.
3. Install Node.js 22 or newer and npm. Clone and build the repo:

   ```sh
   git clone https://github.com/KerkhofMe/wow-armory-mcp.git
   cd wow-armory-mcp
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

## Look up a character

Every tool takes `region`, `realm`, and `name`, for example `{"region":"us","realm":"area-52","name":"Charactername"}`. Use the Blizzard **realm slug** from the Armory URL (`area-52` for Area 52, `malganis` for Mal'Ganis), not the display name. Names and slugs are case-insensitive; preserve accents and non-Latin characters. For a realm you cannot find in the Armory URL, Blizzard's [Realm Index](https://community.developer.battle.net/documentation/world-of-warcraft/game-data-apis) (`/data/wow/realm/index`, `namespace=dynamic-<region>`) lists canonical slugs.

| Tool | Data |
|---|---|
| `wow_character_summary` | Level, race, class, active specialization, faction, guild, item levels, and achievement points when published |
| `wow_character_equipment` | Equipped items by slot, including item IDs, quality, and item levels |
| `wow_character_achievements` | Achievement totals and a page of completed achievements; optional `search` by name |
| `wow_character_collection` | A page of collected `mounts` or battle `pets` via `collection`; optional `search` by name |
| `wow_character_mythic_plus` | Current rating, period and best runs, and season IDs; pass `season_id` for season-specific rating and best runs |
| `wow_character_pvp` | Honor level, honorable kills, and bracket slugs; pass a `bracket` such as `2v2` for rating and match statistics |

Achievements, collections, and Mythic+ runs accept `offset` (default `0`) and `limit` (default `25`, maximum `100`). Use the returned `next_offset` until it is `null`. `total` is the number of matching entries, not the page length. Achievement `total_quantity` and `total_points` are Blizzard's unfiltered totals. Pagination bounds tool output; Blizzard returns the collection in one upstream request per call.

Supported `region` values are `us` (Americas/Oceania), `eu` (Europe), `kr` (Korea), and `tw` (Taiwan). Labels use `en_US`, `en_GB`, `ko_KR`, and `zh_TW`, respectively. Classic and mainland China are not supported. Data reflects what Blizzard last published: private or inactive characters and characters without certain activities may return `NOT_FOUND`. A character 404 cannot distinguish those cases from a typo. Refreshes can lag behind the game; this server does not cache character responses. For `RATE_LIMITED`, wait before retrying; the tool reports Blizzard's retry delay when provided.

## Develop

`npm run build` compiles the TypeScript. `npm test` builds and runs the OAuth/client tests and the MCP integration tests. `npm run test:stdio` runs only the stdio integration tests, which launch the compiled server and exercise it with the official SDK client and a loopback mock of Battle.net. Tests do not require credentials or call the live Blizzard API.
