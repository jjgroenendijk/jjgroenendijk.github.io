---
title: "Windows Client Sysprep"
---

# Setup a Windows Client Template
Before getting your hands dirty with [Ansible](https://www.ansible.com/) or [Endpoint Manager (Intune)](https://www.microsoft.com/en-us/security/business/endpoint-management/microsoft-intune), it is good to know how sysprepping works under the hood.
This pages is a guide to sysprep a Windows client manually.
Knowing how to prepare a system manually will help with troubleshooting later on when using automated tools.

## QEMU specific config
The next 3 paragraphs are meant for QEMU (or virt-manager) environments, but might be tailored to other hypervisors.

### Set correct storage type
Windows does not have the VirtIO storage drivers integrated.
Make sure to download the [VirtIO ISO](https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md) first and attach them to the VM when setting up Windows.
Make sure to use the VirtIO drive type when configuring the storage for the Windows Guest.
During installation the Windows setup won't find the storage. Let Windows search the attached virtual CD-ROM and install the VIOSTOR drivers for the appropriate version of Windows.

### Boot to Audit mode
To install a Windows guest quickly, enter `CTRL+SHIFT+F3` at the first setup page after installing.
This way the (virtual) machine boots quickly to the desktop without having to do any form of setup.

### Install VM guest drivers
For a better experience with interacting with the virtual machine, install the VirtIO drivers (guest tools).
Also needed to share the clipboard between the host and the guest.
Which might be useful for copying scripts and urls.
Drivers are available here: [https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md](https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md).
Use the command below to install the guest tools.
The driveletter might differ on other systems.https://www.ansible.com/
```PowerShell
# Define URL and path for download
$url = "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win.iso"
$isoPath = "$env:ProgramData\virtio-win.iso"

# Download the ISO file
Invoke-WebRequest -Uri $url -OutFile $isoPath

# Mount the ISO file and get the drive letter
$mountedIso = Mount-DiskImage -ImagePath $isoPath -PassThru
$driveLetter = ($mountedIso | Get-Volume).DriveLetter

# Install drivers and wait until install is done
Start-Process -FilePath "msiexec.exe" -ArgumentList "/i $($driveLetter):\virtio-win-gt-x64.msi /qn ADDLOCAL=ALL" -Wait

# Unmount and remove ISO file
Dismount-DiskImage -ImagePath $isoPath
Remove-Item $isoPath
```

### Install VM guest tools
Besides drivers, consider installing the guest tools.
This wil help resizing the window in which the virtual machine is displayed.
This can be done by manually installing the [guest tools](https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win-guest-tools.exe), or executing the following:
```PowerShell
# Define URL and path for download
$url = "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win-guest-tools.exe"
$setupPath = "$env:ProgramData\virtio-win-guest-tools.exe"
$arguments = "/S"

# Download the ISO file
Invoke-WebRequest $url -OutFile $setupPath

# Install the setup. Remove setup when done.
Start-Process $setupPath $arguments -Wait
Remove-Item $setupPath

```

## Remote Access
Setting up remote access is entirely optional, but makes it a lot easier to configure a Windows client.

### Create remote user
When booting to audit mode in Windows, the default Administrator account is used for setting up the system.
This account is blocked from using SSH or other remote management tools.
Going in and out the VM is cumbersome, so the first thing to do is setting up a remote administrator account.
Execute the following command in the VM to setup an administrator account for remote management.
The password creation for the user is insecure and should only be used in isolated environments. Use with caution.
```PowerShell
New-LocalUser -Name "remote" -Password (ConvertTo-SecureString -AsPlainText "InsecurePassword" -Force) -AccountNeverExpires -PasswordNeverExpires
Add-LocalGroupMember -Group "Administrators" -Member "remote"
```

### Hide remote user (optional)
Hide the created user in the login screen:
```PowerShell
New-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "SpecialAccounts" -Force
New-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts" -Name "UserList" -Force
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList" -Name "remote" -Value 0 -PropertyType "DWord" -Force
```

### Install OpenSSH
Use the following commands to setup a SSH server:
```PowerShell
Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"
Set-Service -Name "sshd" -StartupType "Automatic"
Start-Service "sshd"
```

### Install SSH keys
Run this on a local computer to copy the ssh key to the server and add it to the local ssh agent:
```Bash
ssh-keygen -t ed25519 -C "Windows_Server" -f "$HOME/.ssh/Windows_Server"
ssh-copy-id -s -i "$HOME/.ssh/Windows_Server.pub" remote@HOST
eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/Windows_Server"
chmod 0600 "$HOME/.ssh/Windows_Server"
```

Configure SSH to use the specific key that has just been created.
Otherwise the SSH key has to be specified every time when connecting.
Check the IP address of the Windows Server installation.
Edit the SSH config file on the Linux host to specify the key and the IP address.
Later on the hostname will be used instead of the IP address.
Add this to the .ssh/config file:
```Bash
Host remote@IP-ADDRESS
IdentityFile "~/.ssh/Windows_Server"
```

### SSH configuration
Now login on the server again. Change these lines in `%programdata%\ssh\sshd_config`.
You might want to install Chocolatey and vim first.
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

### Updating Shell

When connecting over SSH the first time, the old CMD shell is presented.
Make sure to enter a PowerShell shell with this command:
```PowerShell
powershell.exe
```
Update PowerShell to the latest version and set as default shell for SSH sessions:
```PowerShell
iex "& { $(irm https://aka.ms/install-powershell.ps1) } -UseMSI"
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Program Files\PowerShell\7\pwsh.exe" -PropertyType String -Force
```
## Windows configuration

### Update Windows
Windows somehow does not have a way to update over a remote connection.
Why Microsoft is leaving this functionality purposefully out of Windows I cannot explain.
To get around these limitations, install the PSWindowsupdate library (or module), script a update method and automate the script using task scheduler.
Be aware that this gives the end user a blue powershell popup everytime someone with administrator privileges logs in.
```PowerShell
# Set basic info for script and task
$ScriptName = "Windows Updater"
$ScriptPath = "\Custom Scripts"
$ScriptDirectory = "$($env:programdata)\Scripts"

# Write here what script should contain
$ScriptContent = @'
if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
    Install-PackageProvider -Name NuGet -Force
}

# Check if PSWindowsUpdate module is installed and install it if not
if (-not (Get-Module -Name PSWindowsUpdate -ListAvailable -ErrorAction SilentlyContinue)) {
    Install-Module PSWindowsUpdate -Force
}

Add-WUServiceManager -MicrosoftUpdate -Confirm:$false
Get-WindowsUpdate -Install -AcceptAll -AutoReboot
'@

# Create folder in desired location
if (!(Test-Path $ScriptDirectory)) {
    New-Item -ItemType Directory -Path $ScriptDirectory
}

# Write script content to file
Set-Content -Path "$ScriptDirectory\$ScriptName.ps1" -Value "$ScriptContent"

# Unregister old script
Unregister-ScheduledTask -TaskName "$ScriptName" -Confirm:$false

# Create scheduled task to execute "windows-updater.ps1" on logon as any user with admin privileges
$principal = New-ScheduledTaskPrincipal -GroupId "Administrators" -RunLevel Highest
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptDirectory\$ScriptName.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "$ScriptName" -taskpath "$ScriptPath" -Action $action -Trigger $trigger -Settings $settings -Principal $principal

# Start the task immediately
Start-ScheduledTask -TaskName $ScriptName
```

### Disable Hibernation
a VM does not need to write RAM to disk for hibernation. Any decent hypervisor can do it for a VM.
A Windows guest will probably use a lot of cpu cycles and memory in comparison to Linux based guests on the hypervisor host.
Here are a few quick commands to optimize Windows running in a virtual environment without the guest OS intervening.
```PowerShell
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name HibernateEnabled -Value 0
```

### Disable unneeded Windows Services
Disable some Windows System services that are not needed in a VM:
```PowerShell
$disableServicesVM = @(
        "SysMain"        # Preload apps in memory
        "Spooler"        # Print Spooler
        "WerSvc"         # Windows Error Reporting
        "MapsBroker"     # Windows Maps Downloader
        "XblAuthManager" # Xbox (1/4)
        "XblGameSave"    # Xbox (2/4)
        "XboxGipSvc"     # Xbox (3/4)
        "XboxNetApiSvc"  # Xbox (4/4)
        )

foreach ($service in $disableServicesVM) {
    Stop-Service -Name $service; Set-Service -Name $service -StartupType Disabled
}
```

### Remove optional features
To save a little storage in the VM some optional preinstalled Windows features can be removed.
Notepad can be safely removed, the UWP store version stays.
Use with caution in production!
```PowerShell
Disable-WindowsOptionalFeature -Online -FeatureName WindowsMediaPlayer -NoRestart

$featureRemoval = @(
    "*wifi-client*"
    "*internetexplorer*"
    "*Wallpaper-Content-Extended*"
    "*Notepad-System*"
    "*LanguageFeatures-Handwriting*"
    "*LanguageFeatures-OCR*"
    "*LanguageFeatures-Speech*"
    "*LanguageFeatures-TextToSpeech*"
    "*TabletPCMath*"
    "*WordPad*"
)

$FoD = (Get-WindowsPackage -Online).PackageName

foreach ($feature in $FoD) {
    foreach ($removal in $featureRemoval) {
        if ($feature -like $removal) {
            Write-Output "Removing: $feature"
            Remove-WindowsPackage -PackageName $feature -Online -NoRestart -ErrorAction SilentlyContinue
        }
    }
}

```

### Install a package manager
Install Chocolatey package manager. Winget isn't supported yet on Windows Server.
After installing Chocolatey, install Sysinternals and Vim:
```PowerShell
Set-ExecutionPolicy Bypass -Scope Process -Force;
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072;
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install sysinternals vim --params "'/NoDesktopShortcuts /NoContextmenu'" -y
```

### Package updater
To automatically update all installed packages from chocolatey, install a custom script that checks for updates every logon:
```PowerShell
# Set basic info for script and task
$ScriptName = "Package Updater"
$ScriptPath = "\Custom Scripts"
$ScriptDirectory = "$($env:programdata)\Scripts"

# Write here what script should contain
$ScriptContent = @'
cup all -y
'@

# Create folder in desired location
if (!(Test-Path $ScriptDirectory)) {
    New-Item -ItemType Directory -Path $ScriptDirectory
}

# Write script content to file
Set-Content -Path "$ScriptDirectory\$ScriptName.ps1" -Value "$ScriptContent"

# Unregister old script
Unregister-ScheduledTask -TaskName "$ScriptName" -Confirm:$false

# Create scheduled task to execute "package-updater.ps1" on logon as any user with admin privileges
$principal = New-ScheduledTaskPrincipal -GroupId "Administrators" -RunLevel Highest
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptDirectory\$ScriptName.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "$ScriptName" -taskpath "$ScriptPath" -Action $action -Trigger $trigger -Settings $settings -Principal $principal

# Start the task immediately
Start-ScheduledTask -TaskName $ScriptName
```

### Remove OneDrive
In a corporate environment OneDrive is probably used, but for a homelab it can be deleted from the image.
Use these commands:
```PowerShell
# Stop OneDrive service
Get-Service -Name "OneSync*" | Stop-Service

# Stop OneDrive process
Get-Process -Name "OneDrive*" | Stop-Process -Force

# Delete OneDrive scheduled tasks
Get-ScheduledTask -TaskPath '\' -TaskName 'OneDrive*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

# Remove OneDrive from default registry hive


```

### Setting user preferences
This is a dark type of magic in the Windows world.
To preconfigure user settings, the systems has to be in sysprep mode, and then the default registry hive can be loaded to insert registry settings for new users.
Upon preparing a new user, Windows will copy these settings to new User accounts.
This way of configuring settings for users is not optimal, but it is a way to do it manually (albeit scripted) and without external tools.
```PowerShell
# Load the default registry hive under HKLM\zzz
reg load "hklm\zzz" "C:\Users\Default\NTUSER.DAT"

# Remove OneDrive auto start setting.
Remove-ItemProperty -Path "HKLM:\zzz\Default\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "OneDriveSetup" -Force

# Disable preinstalled apps (no known location for user setting)
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "OemPreInstalledAppsEnabled" -Value 0
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "PreInstalledAppsEnabled" -Value 0
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SilentInstalledAppsEnabled" -Value 0

# Disable Windows Spotlight and Spotlight features (lockscreen picture slideshow)
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "RotatingLockScreenEnabled" -Value 0
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "RotatingLockScreenOverlayEnabled" -Value 0

# Disable "Show suggestions occasionally in Start"
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SystemPaneSuggestionsEnabled" -Value 0

# Disable "Get tips, tricks, and suggestions as you use Windows"
Set-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SoftLandingEnabled" -Value 0

# Disable "Show the Windows welcome experience after updates ..."
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SubscribedContent-310093Enabled" -Value 0 -PropertyType DWORD -Force

# Disable suggested content in settings
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SubscribedContent-338393Enabled" -Value 0 -PropertyType DWORD -Force
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SubscribedContent-353694Enabled" -Value 0 -PropertyType DWORD -Force
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SubscribedContent-353696Enabled" -Value 0 -PropertyType DWORD -Force

# Disable "Get tips and suggestions when I use Windows"
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SubscribedContent-353696Enabled" -Value 0 -PropertyType DWORD -Force

# Hide taskbar search icon
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\Search" -Name "SearchboxTaskbarMode" -Value 0 -PropertyType DWORD -Force

# Align taskbar to the left
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" -Name "TaskbarAl" -Value 0 -PropertyType DWORD -Force

# Disable Privacy options at OOBE
New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\OOBE"
New-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\OOBE" -Name "DisablePrivacyExperience" -Value 1 -Type DWORD -Force
# Disable First logon animation
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "EnableFirstLogonAnimation" -Value 0 -Type DWORD -Force
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "EnableFirstLogonAnimation" -Value 0 -Type DWORD -Force
# Disable "Let's finish settings up your device"
New-Item -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement"
New-ItemProperty -Path "HKLM:\zzz\Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement" -Name "ScoobeSystemSettingEnabled" -Value 0 -Type DWORD -Force

# Restore old context menu in Windows
New-Item -Path "HKLM:\zzz\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32" -Force | Out-Null
New-ItemProperty -Path "HKLM:\zzz\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32" -Name "(default)" -Value "" -Force

# Close open handles
[gc]::Collect()

# Wait a second to avoid race condition
Start-Sleep -Seconds 1

# Unmount default registry hive
reg unload "hklm\zzz"
```

## Wrapping up

### Cleanup and health check
Execute this to cleanup the machine:
```PowerShell
Get-ChildItem -Path ‘HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches’ |
New-ItemProperty -Name StateFlags001 -Value 2 -PropertyType DWORD
Start-Process -FilePath CleanMgr.exe -ArgumentList ‘/sagerun:1’ -Wait
```
Check the health of the system:
```PowerShell
Repair-WindowsImage -Online -RestoreHealth
Start-Process -FilePath "C:\Windows\System32\sfc.exe" -ArgumentList '/scannow' -Wait -WindowStyle Hidden
Repair-Volume  -DriveLetter C -Scan
```
Zeroing the disk, which is important for shrinking the file size of the VM storage file.
```PowerShell
sdelete -z C: -accepteula
```

### Sysprep
Sysprep the machine (this doesn't seem to work over SSH):
```PowerShell
Start-Process -FilePath "C:\Windows\System32\Sysprep\Sysprep.exe" -ArgumentList "/oobe /shutdown"
```
If this doesn't work over SSH, then open the sysprep utility manually.
Set system cleanup action to: Enter System Out-Of-Box Experience (OOBE).
Leave the generalized tickbox unticked (unless template will be used on another machine/hypervisor).
Set shutdown option to: Shutdown
Click on OK.
The system will now prepare itself for a new deployment.
If the machine is booted again, the sysprep will have to run again.

### Shrink template size
After zero-ing the disk and making a backup, the disk size of the VM can be shrinked.
This can save a lot of storage. Zstd compression is way faster and uses less space then the standard zlib compression.
So to save time and space we use zstd compression.
Execute the following commands:
```PowerShell
qemu-img convert -c -O qcow2 -o compression_type=zstd win11.qcow2 win11-compressed.qcow2
```

### Backup the template
Backing up the template is simply done by copying the storage file.
To apply zstd compression to the vm storage file, use this:
```Bash
tar -C "/STORAGE/DIRECTORY" -acvf windows-template.tar.zst STORAGE-FILE.qcow2
```
