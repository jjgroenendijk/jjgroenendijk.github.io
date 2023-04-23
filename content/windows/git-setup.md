# Git setup in Windows
Setting up Git in Windows is very similar to how one would set it up on linux and OS X.
Here is how to install git and connect to github over SSH.

```PowerShell
winget install git.git
get-service ssh-agent | set-service -startuptype automatic -passthru | start-service
new-item -itemtype "directory" -path "$HOME" -name ".ssh"
ssh-keygen -t ed25519 -C "your_email@example.com" -f "$HOME/.ssh/githubkey"
ssh-add "$HOME/.ssh/githubkey"
notepad.exe "$HOME/.ssh/githubkey.pub"
```

Notepad will open. Copy the public key displayed and paste it in your [Github settings](https://github.com/settings/keys).
Click on: "New SSH key". Paste the copied public key.

Test your connection to Github:
```PowerShell
ssh -T git@github.com
```

## SSH configuration

Configure SSH to use the correct key when connecting to Github (or any other git hosting).
```PowerShell
Add-Content -Path "$env:userprofile\.ssh\config" -Value @'
Host github.com
  Hostname github.com
  IdentityFile ~/.ssh/githubkey
'@
```
## Git configuration
Go to your [github configuration](https://github.com/settings/emails). Enable options: "Keep my email addresses private" and "Block command line pushes that expose my email". Copy the @users.noreply.github.com emailaddress from above.
Use that address when configuring your email on your system. 

Set your username:
```bash
git config --global user.name "user"
git config --global user.email "user@users.noreply.github.com"
```
