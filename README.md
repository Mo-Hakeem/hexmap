# HexMap — Hex Viewer

A custom editor for VS Code / Devin Desktop / Windsurf that renders embedded
firmware images — **Intel HEX**, **Motorola S-records**, and **raw binary** —
as an address-accurate hex dump with automatic **gap detection**.

Built for firmware engineers working with `.hex`, `.srec`, `.s19`, `.mot` and
`.bin` build artifacts.

## Features

- **Absolute addressing** — every row shows the real target address
  (e.g. `0x08000000`), not the file offset. Unaligned segment starts are padded
  so bytes always align under their `00..0F` / `00..1F` lane headers.
- **Configurable layout** — switch **Cols** (`8`, `16`, `32` bytes/row),
  **Group** (`1`, `2`, `4`, `8` bytes), **Endian** (`LE` / `BE`), and toggle
  the ASCII column, with wider 4-byte and 8-byte lane spacers.
- **Base address for `.bin` files** — set a custom base offset (e.g.
  `0x08000000` or `0x00004000`) for raw binary images.
- **Gap detection & Memory Map** — non-contiguous address ranges are shown as
  explicit `GAP` rows and visualized in a clickable memory map bar above the
  view.
- **Format detection** — Intel HEX record types `00–05` (extended linear and
  segment addressing, checksum verification, `03`/`05` entry points), Motorola
  S-records `S0–S9` (`S19/S28/S37` with checksum verification and `S7/S8/S9`
  entry points), or raw binary fallback.
- **Interactive Data Inspector** — click any byte (or `Shift+Click` a range) to
  inspect `u8/i8`, `u16/i16`, `u32/i32`, `u64`, `f32`, binary bits, and
  selection CRC-32, or **Copy Hex / Copy C / Copy Py / Export `.bin`**.
- **Find & Filter** — search across row boundaries by `0x` address, hex bytes,
  or ASCII with Next/Prev (`Enter` / `Shift+Enter`), or switch to **filter** mode
  to hide non-matching rows.
- **Strings & File Info** — extract printable ASCII strings (click to jump),
  and inspect File SHA-256, Payload SHA-256, Payload CRC-32, and clickable
  segments/gaps.

## Supported file extensions

| Extension | Handling |
|---|---|
| `.hex` `.ihex` `.h68` | Intel HEX |
| `.mot` `.srec` `.s19` `.s28` `.s37` | Motorola S-record |
| `.bin` (or anything unrecognized) | Raw binary at base 0 |

## Usage

1. Install: `Extensions: Install from VSIX...` → select `hexmap-x.y.z.vsix`
   (or open the extension folder in the Extension Development Host).
2. Open a supported file — it opens in the Hex Viewer automatically.
3. Use the toolbar to filter / hide gaps, click addresses to copy them.

The view is **read-only** — it never modifies the file on disk. Edits made in
the text editor re-render the hex view automatically.

## Keyboard / mouse

- Click any address cell → copies `0x........` to clipboard.
- Type in the filter box → live-filters rows by address, byte values or ASCII.

## Building from source

Requires Node.js and npm:

```sh
npm install
npm run compile      # tsc -> out/
```

Package a `.vsix` (Node ≥ 20 for `vsce`, or use the helper script on Node 18):

```powershell
.\make_vsix.ps1      # produces hexmap-<version>.vsix
```

## Publishing

- Bump `version` in `package.json` **and** `extension.vsixmanifest`
  (they must match), then re-run `make_vsix.ps1`.
- Publisher namespace `mohamedhakeem` is defined in both files — change both
  together if needed.
- Open VSX publish: `ovsx publish` (Eclipse account, free).

## License

MIT — see [LICENSE](LICENSE).
