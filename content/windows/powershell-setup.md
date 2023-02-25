## Permanent Aliases

Edit powershell profile:

```powershell
notepad.exe $profile
```

Configure alias for currect session or save in profile to save alias permanently:

```powershell
Set-Alias -Name 'fix' -Value 'DISM /Online /Cleanup-Image /RestoreHealth'
```

## Youtube audio download alias

Put this text in Powershell profile. Depends on [yt-dlp.](https://community.chocolatey.org/packages/yt-dlp)

```powershell
Function youtube-dl-audio {
  $MusicPath = [Environment]::GetFolderPath("MyMusic")
  yt-dlp `
  --extract-audio `
  --embed-thumbnail `
  --add-metadata `
  --format m4a `
  --output "$MusicPath\%(title)s.%(ext)s" `
  --restrict-filenames `
  --quiet `
  --progress `
  @args
  }

Set-Alias -Name 'yt-audio' -Value 'youtube-dl-audio'
```

This alias, combined with a function, downloads any given youtube video as audio file to the current music folder.
