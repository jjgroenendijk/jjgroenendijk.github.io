# Windows server setup

## VM Guest tools
Install Windows Server without GUI. Next, install VirtIO drivers when using QEMU as a hypervisor:
```PowerShell
msiexec /i "E:\virtio-win-gt-x64.msi" /qn ADDLOCAL=ALL /forcerestart
```

## SSH Setup
Now the next thing might be considered controversial by some Windows Admins.
Setting up a SSH server.
```PowerShell
Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"
Set-Service -Name "sshd" -StartupType "Automatic"
Start-Service "sshd"
```

One should run this on a local computer to copy the ssh key to the server and add it to the local ssh agent:
```Bash
ssh-keygen -t ed25519 -C "Windows_Server" -f "$HOME/.ssh/Windows_Server"
ssh-copy-id -s -i "$HOME/.ssh/Windows_Server.pub" administrator@HOST
eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/Windows_Server"
```

Now login on the server again. Change these lines in `%programdata%\ssh\sshd_config`. You might want to install Chocolatey and vim first.
Code snippet below reflects the correct configuration.
```Bash
AuthenticationMethods publickey
PubkeyAuthentication yes
...
PasswordAuthentication no
PermitEmptyPasswords no
...
#Match Group administrators
#       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
```

Afterwards, run `Restart-Service "sshd"` on the Windows Server.

### Shell update
Update PowerShell to the latest version and set as default shell for SSH sessions:
```PowerShell
iex "& { $(irm https://aka.ms/install-powershell.ps1) } -UseMSI"
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Program Files\PowerShell\7\pwsh.exe" -PropertyType String -Force
```

## Update Windows
Update Windows (this doesn't work yet over SSH).
```PowerShell
Install-Module PSWindowsUpdate -Force
Add-WUServiceManager -MicrosoftUpdate -Confirm:$false
Get-WindowsUpdate -AcceptAll -Install -AutoReboot
```

## Package manager

### Chocolatey
Install Chocolatey and Sysinternals:
```PowerShell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install sysinternals -y
```

### Winget
To install Winget, we need to switch over to the old PowerShell, due to [this
bug](https://github.com/PowerShell/PowerShell/issues/13138). Then the Appx module can be imported and Winget can be installed. After installation the setup file is deleted
and with exit one exits the powershell 1.0 session.
```PowerShell
powershell.exe

Import-Module Appx

$URL = "https://api.github.com/repos/microsoft/winget-cli/releases/latest"
$URL = (Invoke-WebRequest -Uri $URL).Content | ConvertFrom-Json |
        Select-Object -ExpandProperty "assets" |
        Where-Object "browser_download_url" -Match '.msixbundle' |
        Select-Object -ExpandProperty "browser_download_url"

Invoke-WebRequest -Uri $URL -OutFile "Setup.msix" -UseBasicParsing

Add-AppxPackage -Path "Setup.msix"

Remove-Item "Setup.msix"

exit
```

Winget is not yet added to the system path. To fix this, execute the following commands:
```PowerShell
To do
```

To be continued
