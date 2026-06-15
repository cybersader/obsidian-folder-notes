# Obsidian folder notes — cybersader sync-safe fork

> **This is a fork of [LostPaul/obsidian-folder-notes](https://github.com/LostPaul/obsidian-folder-notes).**
> It adds a **sync-safe auto-create guard** that prevents folder notes from being
> silently blanked when a sync engine (Obsidian Sync, LiveSync, Syncthing…) delivers
> a folder *before* its note. When auto-create fires on the synced folder, the guard
> waits for the real note (via its create event, an Obsidian-Sync-idle signal, and a
> disk check) instead of immediately writing an empty note that races — and can lose
> to — the inbound one. Configurable under **Settings → Folder notes → Sync safety**.
> Plugin id stays `folder-notes` so it replaces the store version. Install via BRAT.
>
> All credit for the plugin itself goes to Lost Paul; this fork only hardens the
> auto-create path. Licensed GPL-3.0-or-later, same as upstream.

Folder notes is a plugin for the note taking app  [Obsidian](https://obsidian.md/) that lets you attach notes to folders so that you can click on the name of a folder to open the note like in the app [Notion](https://www.notion.so/).
This plugin has some unique features that separate it from similar "Folder note" plugins like opening folder notes through the path, creating folder notes for every existing folder, templater/template support and more.

Support the development of the plugin

<a href='https://ko-fi.com/D1D1GHGSI' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>
## Documentation & download link
The plugin can be downloaded by clicking on https://obsidian.md/plugins?id=folder-notes and then on install. If you need help with the plugin or want to  know what the features are that the plugin has then you can find the documentation at https://lostpaul.github.io/obsidian-folder-notes/.

## How to install the beta version

The easiest option is to install the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) and then to follow the following guide: https://tfthacker.com/brat-quick-guide & use this link https://github.com/LostPaul/obsidian-folder-notes to install the beta version.

Join the Discord server to chat about the beta and to also get the beta user role.

## Discord server
[For regular updates on Folder Notes and my other plugins, join the Discord server to get notified and participate in discussions.](https://discord.gg/4UQEDfQmuH)
