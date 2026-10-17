# Sim RaceCenter Director for Stream Deck

An open-source Stream Deck plugin for operating Sim RaceCenter Director. The plugin is a thin
client of Director's local operator-control API; it never connects to OBS directly.

## Install and pair

1. Install the `.streamDeckPlugin` file from a GitHub Release.
2. In Director, open **Settings → Control surfaces → Pair control surface** and create a pairing
   code.
3. Add **Connection** to a key, open its property inspector, enter the Director URL, pairing code,
   and a recognizable surface name, then select **Pair**.
4. Once paired, the key and other actions show the current Director connection and state.

The default URL is `http://127.0.0.1:8782`. If Director is configured to listen on a LAN interface,
use that host's local address and ensure the network is trusted.

## Actions

| Page | Action | Behavior |
| --- | --- | --- |
| Director | Run Status | Displays IDLE, PREFLT OK, LIVE, PAUSED, or HELD. |
| Director | Preflight | Runs Director preflight checks. |
| Director | Start Run | Requests run start; Director remains authoritative about preflight/admission. |
| Director | Pause / Resume | Pauses or resumes the active run. |
| Director | Stop Run | Hold for one second to stop a run. |
| Director | ALL STOP | Red key; hold for one second to issue the emergency command. |
| Director | Connection | Shows connection status; press to reconnect. |
| OBS | OBS Scene | Select one of Director's live-scene slots 1–8 (automatic) or an explicit OBS scene; shows program tally. |
| OBS | OBS Stream | Starts streaming on press; hold to stop. |
| OBS | OBS Record | Starts recording on press; hold to stop. |
| Services | Service | Select YouTube Chat, Chat Agent, or Spectator; starts/stops when allowed. |

## Bundled profile

The plugin includes the **Sim RaceCenter** profile for the 15-key Stream Deck MK.2. It is bundled
with the plugin package and has three pages with direct Go to Page navigation:

```text
Page 1 DIRECTOR                          Page 2 OBS                              Page 3 SERVICES
[STATUS][PREFLT][START ][PAUSE ][STOP  ] [STREAM][RECORD][SCN 1 ][SCN 2 ][SCN 3 ] [YT CHT][CHT AG][SPECT ][      ][      ]
[ALLSTP][      ][      ][      ][      ] [SCN 4 ][SCN 5 ][SCN 6 ][SCN 7 ][SCN 8 ] [      ][      ][      ][      ][      ]
[PAGE 1][PAGE 2][PAGE 3][      ][CONN  ] [PAGE 1][PAGE 2][PAGE 3][STATUS][CONN  ] [PAGE 1][PAGE 2][PAGE 3][STATUS][CONN  ]
```

Status and connection keys remain available on every page. Page 2's scene keys are configured as
live-scene slots by default. Each slot resolves to the corresponding entry in Director's configured
`obs.liveScenes` list, so changing the Director list does not require reconfiguring the deck. A slot
that has no live scene displays `SCENE N` with an em dash and alerts if pressed. Explicit scene
selection takes precedence over a slot.

To inspect the profile, install the plugin package or open
`com.simracecenter.director.sdPlugin/profiles/Sim RaceCenter.streamDeckProfile`, then select
**Sim RaceCenter** in Stream Deck. In the tested Stream Deck 7.6.0.23012 VM, the on-screen key grid
was an editor: clicking a key selected it for configuration and did not deliver `keyDown` to the
plugin. The app exposed no separate Virtual Stream Deck device in its device selector. Use a physical
deck or the fake-host end-to-end tests to exercise key presses.

## Security

- Director listens on loopback by default. LAN access must be explicitly enabled in Director.
- Pairing issues a revocable per-surface token. The token is stored only in Stream Deck global
  plugin settings and is never included in per-action settings or logs.
- The plugin sends authenticated requests only to Director's control API. It does not store or
  transmit OBS credentials.
- The API rejects browser-origin requests and limits JSON command bodies.

## Development

Requires Node.js 24 and npm:

```sh
npm install
npm run build
npm run typecheck
npm test
npm run test:e2e
npm run validate
npm run pack
```

`npm run build` creates the bundled profile from `profiles/sim-racecenter/` before building the
plugin. `npm run build:profile` rebuilds only the profile archive. `npm run watch` rebuilds the plugin
as source changes. The generated plugin entry point is
`com.simracecenter.director.sdPlugin/bin/plugin.js`.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
