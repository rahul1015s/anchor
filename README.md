# Anchor

<p align="center"><img src="assets/icon-256.png" width="120" alt="Anchor icon"></p>

**Focus sessions for Linux that block distracting websites and apps until you finish.**
Tell Anchor what you're working on, pick a length, and it keeps the distractions out. Getting past a block is
deliberately a little annoying: you have to **wait 60 seconds and write down why**.

Built with Electron + a small Chrome extension. Developed and tested on Fedora (GNOME).

## How it works

1. Open Anchor and type **one goal** ("Build the login page and write its tests"). Pick a length (25–120 min or custom).
2. Press **Start focus session**. The window shrinks to a small always-on-top timer.
3. During the session:
   - **Websites** on your blocklist (or everything except your allowlist) are redirected to a calm block page that shows your goal and time left.
   - **Apps** on your list (Discord, Steam, …) are closed if they open.
   - **Notifications** are muted (GNOME Do Not Disturb) and restored afterwards.
4. Need something anyway? The block page offers *"I really need this site"*: wait 60 s, write a real reason, and it unlocks that site for 5/10/20 minutes. The reason is saved in your history.
5. Ending early works the same way (wait + reason). Otherwise the session ends by itself and you get a **summary**: focus score, blocked attempts, top distractions, and every reason you gave.

### Features

- **Block list *or* allow-only mode** – block distracting sites, or block everything except the work sites you allow
- **App blocker** – closes listed desktop apps; editors, terminals, browsers and system programs are protected and can't be added
- **Cooldown with a written reason** for unlocking a site/app and for ending early (enforced by the app, not just the page)
- **Breaks** – a limited number per session (default 2 × 5 min); blocking pauses and the session is extended by the break
- **Rules are locked during a session** – you can't quietly weaken the blocklist mid-session
- **Focus score & history** – per-session score, 7-day chart, and the reasons you gave
- **Survives restarts** – a running session resumes if the app is restarted
- **Everything stays on your computer** – no accounts, no network

## Install (Fedora / Linux)

Requires **Node.js 18+** (`sudo dnf install nodejs`):

```bash
npx github:rahul1015s/anchor
```

This installs Anchor for your user (no root): app files in `~/.local/share/anchor-app`, an `anchor` command in
`~/.local/bin`, and **Anchor** (with icon) in your app menu. Remove it with:

```bash
npx github:rahul1015s/anchor uninstall           # keep settings/history
npx github:rahul1015s/anchor uninstall --purge   # delete them too
```

### Connect the browser extension (needed for website blocking, ~2 minutes)

Works in Chrome, Brave, Edge and Chromium.

1. Open **Anchor → Settings → Browser extension** (it shows the folder path and has *Open Chrome extensions page*, *Copy folder path* and *Show folder* buttons).
2. In Chrome open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the folder shown in Anchor (`~/.config/Anchor/extension`).
4. Anchor shows **Connected** within a minute.

The extension only talks to Anchor on `127.0.0.1` using a private token generated on your machine, and asks for
the minimum permissions (`webNavigation`, `tabs`, `alarms`). **If Anchor isn't running, the extension allows everything**, so you can never be locked out of the web.

> Anchor writes a fresh copy of the extension to `~/.config/Anchor/extension` every time it starts. Load that folder (not the one in the repo) so the token matches.

## Rules & settings

- **Rules tab** – edit the blocklist, allowlist and app list (suggestions are one click). Locked while a session runs.
- **Settings tab** – cooldown length (30–600 s), breaks per session and break length, default session length, notification muting.

## Development

```bash
git clone https://github.com/rahul1015s/anchor.git && cd anchor
npm install
npm start          # run the app
npm test           # engine tests (node:test)
```

```
core.js        session engine, blocking rules, cooldown, app blocker, local API (no Electron dependency)
main.js        Electron shell: window, compact mode, IPC, notifications
renderer/      UI (home, rules, history, settings, compact session, summary)
extension/     Chrome extension (MV3): redirects blocked sites to the block page
bin/cli.js     npx installer / uninstaller
test/          engine tests
```

## Honest limits

- It's a **self-control aid, not a security tool.** You can still defeat it from outside (kill the app from a terminal, use another browser without the extension, disable the extension). It's built to stop impulses, not determined you.
- Website blocking works only in browsers where the extension is installed. Firefox isn't supported yet.
- The app blocker matches **program names**; Flatpak/Snap apps usually work, but check by adding the app and testing.
- "Mute notifications" uses GNOME settings; other desktops just skip it.
- On Wayland (GNOME) an app can't force itself above other windows. The small session window is a normal window: right-click its title bar (or press Alt+Space) and choose **Always on Top** if you want it to stay visible.

## License

MIT
