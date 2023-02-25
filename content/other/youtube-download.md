---
weight: 1
title: "Youtube download"
---

## Youtube download options
Install `yt-dlp` first:

{{< tabs "12345" >}}

{{< tab "MacOS" >}}
Install using brew:

`brew install yt-dlp ffmpeg`
{{< /tab >}}

{{< tab "Linux" >}}
Install using pacman:

`pacman -S yt-dlp ffmpeg mutagen`
{{< /tab >}}

{{< tab "Windows" >}}
Install using chocolatey:

`choco install yt-dlp ffmpeg`
{{< /tab >}}

{{< /tabs >}}

## Configuration
Write these files to the [correct configuration location](https://github.com/yt-dlp/yt-dlp#configuration).

### General
Configuration applicable to video and audio:

```
# block emojis. replaces spaces with underscores.
--restrict-filenames

# show progress bar
--progress

# mute verbose messages
#--quiet

# continue previous download
--continue

# put the thumbnail in final download
--embed-thumbnail

# embed media metadata in output
--embed-metadata

# output format
--output "%(title)s.%(ext)s"

# keep track of downloads in this archive file
--download-archive $HOME/.config/yt-dlp/archive.txt
```

### Audio
Configuration applicable to audio:

```
# extract audio from media file
--extract-audio

# format to use for audio files
--audio-format m4a
```

### Video

This config will force x264+AAC codecs in a mp4 container. Configuration applicable to video:

```
--embed-subs
--convert-subs srt
--embed-chapters
--format "bv[vcodec^=avc]+ba[acodec^=mp4a]"
--merge-output-format mp4
```
