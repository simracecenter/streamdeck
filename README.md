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
| OBS | OBS Scene | Select an OBS scene in the property inspector; shows program tally. |
| OBS | OBS Stream | Starts streaming on press; hold to stop. |
| OBS | OBS Record | Starts recording on press; hold to stop. |
| Services | Service | Select YouTube Chat, Chat Agent, or Spectator; starts/stops when allowed. |

Recommended 15-key layout:

```text
Page 1 DIRECTOR                          Page 2 OBS                              Page 3 SERVICES
[STATUS][PREFLT][START ][PAUSE ][STOP  ] [STREAM][RECORD][SCN 1 ][SCN 2 ][SCN 3 ] [YT CHT][CHT AG][SPECT ][      ][      ]
[ALLSTP][      ][      ][      ][      ] [SCN 4 ][SCN 5 ][SCN 6 ][SCN 7 ][SCN 8 ] [      ][      ][      ][      ][      ]
[>DIR  ][ OBS  ][ SVC  ][      ][CONN  ] [ DIR  ][>OBS  ][ SVC  ][STATUS][CONN  ] [ DIR  ][ OBS  ][>SVC  ][STATUS][CONN  ]
```

Status remains visible on each page. Scene keys can be assigned from the per-key dropdown. A bundled
profile is not included in this initial version. Stream Deck 7.6's Virtual Stream Deck exported a
three-page, 15-key profile (device model `20GAA9901`), but the export only contained built-in page
navigation actions, not this plugin's configured Director / OBS / Services layout. The Virtual Stream
Deck editor does not simulate physical key presses on this VM; key behavior is exercised by the
fake-host end-to-end tests instead.

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
npm test
npm run test:e2e
npm run validate
npm run pack
```

`npm run watch` rebuilds the plugin as source changes. The generated plugin entry point is
`com.simracecenter.director.sdPlugin/bin/plugin.js`.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
