---
title: "Windows Client Sysprep"
---

# Setup a Windows Client Template
This pages is a guide to sysprep a Windows client manually.
There are a lot of tools available for preparing a Windows image, but it's good to know how this is handled manually.
Knowing how to prepare a system manually will help with troubleshooting later on with [Ansible](https://www.ansible.com/) or [Endpoint Manager (Intune)](https://www.microsoft.com/en-us/security/business/endpoint-management/microsoft-intune).

## QEMU specific config
The next 3 paragraphs are meant for QEMU (or virt-manager) environments, but might be tailored to other hypervisors.

### Set correct storage type
Windows does not have the VirtIO storage drivers integrated.
Make sure to download the [VirtIO ISO](https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md) first and attach them to the VM when setting up Windows.
Make sure to use the VirtIO drive type when configuring the storage for the Windows Guest.
During installation the Windows setup won't find the storage. Let Windows search the attached virtual CD-ROM and install the VIOSTOR drivers for the appropriate version of Windows.

### Boot to Audit mode
To install a Windows guest quickly, enter `CTRL+SHIFT+F3` at the first setup page after installing.
This way OOBE is skipped and the desktop is presented quickly.

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
In addition to drivers, it is advisable to install guest tools to enable resizing of the virtual machine window. This can be achieved by either manual installation of the [guest tools](https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win-guest-tools.exe) or by executing the following command:
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
While in audit mode on Windows, the built-in "Administrator" account is utilized.
However, this account is unable to use remote management tools such as SSH.
Switching in and out of the virtual machine is inconvenient, which makes setting up a remote administrator account the first priority.
To establish an administrator account for remote management, execute the following command in the virtual machine.
Please note that the password creation for the user is insecure and should only be used in isolated environments.
Use it with caution.
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
Otherwise one has to specify the SSH key to use when connecting to the installation.
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
When connecting over SSH the first time, one gets the old CMD shell.
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
To get around these limitations, one can install the PSWindowsupdate library (or module), script a update method and automate the script using task scheduler.
Be aware that this gives the end user a blue powershell popup everytime someone with administrator privileges logs in.
```PowerShell
# Set basic info for script and task
$ScriptName = "Windows Updater"
$ScriptPath = "\Custom Scripts"
$ScriptDirectory = "$($env:programdata)\Scripts"

# Write here what script should contain
$ScriptContent = @'
# Check if Nuget is installed. Install if necessary.
$checkPackageProvider = (get-packageprovider | Where-Object {$_.name -contains "nuget"})
if ($checkPackageProvider -eq $null) {
    Write-Output "Installing Nuget Package Provider"
    Install-PackageProvider -Name NuGet -Force
}

# Check and install PSWindowsUpdate
$checkModuleInstall = (Get-Module -ListAvailable -Name PSWindowsUpdate)
if ($checkModuleInstall -eq $null) {
    Install-Module PSWindowsUpdate -Force
}

# Check and import PSWindowsUpdate
$checkModuleImport = (Get-Module -Name PSWindowsUpdate)
if ($checkModuleImport -eq $null) {
    Import-Module PSWindowsUpdate -Force
}

# Check and import Microsoft Update Service
$checkWUServiceManager = (Get-WUServiceManager | Where-Object {$_.Name -eq "Microsoft Update"})
if ($checkWUServiceManager -eq $null) {
    Add-WUServiceManager -MicrosoftUpdate -Confirm:$false
}

# Install all Windows Updates
Get-WindowsUpdate -Install -AcceptAll -AutoReboot
'@

# Create folder in desired location
if (!(Test-Path $ScriptDirectory)) {
    New-Item -ItemType Directory -Path $ScriptDirectory
}

# Write script content to file
Set-Content -Path "$ScriptDirectory\$ScriptName.ps1" -Value "$ScriptContent"

# Unregister old script
Unregister-ScheduledTask -TaskName "$ScriptName" -Confirm:$false -ErrorAction SilentlyContinue

# Create scheduled task to execute "windows-updater.ps1" on logon as any user with admin privileges
$principal = New-ScheduledTaskPrincipal -GroupId "Administrators" -RunLevel Highest
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptDirectory\$ScriptName.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "$ScriptName" -taskpath "$ScriptPath" -Action $action -Trigger $trigger -Settings $settings -Principal $principal

# Start the task immediately
Start-ScheduledTask -TaskName "$scriptpath\$ScriptName"

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
To save a little storage in the VM one might remove some optional preinstalled Windows features.
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
Unregister-ScheduledTask -TaskName "$ScriptName" -Confirm:$false -ErrorAction SilentlyContinue

# Create scheduled task to execute "package-updater.ps1" on logon as any user with admin privileges
$principal = New-ScheduledTaskPrincipal -GroupId "Administrators" -RunLevel Highest
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptDirectory\$ScriptName.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "$ScriptName" -taskpath "$ScriptPath" -Action $action -Trigger $trigger -Settings $settings -Principal $principal

# Start the task immediately
Start-ScheduledTask -TaskName "$scriptpath\$ScriptName"
```

### Remove OneDrive
Removing OneDrive doesn't seem to work yet in audit mode. Normally one would delete OneDrive with these commands:
```PowerShell
Get-service -Name "OneSyncSvc_*" | Stop-Service
Stop-Process -Name "OneDrive"
Remove-Item "$env:USERPROFILE\OneDrive" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\OneDrive" -Recurse -Force
winget uninstall onedrive
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

### Backup the template
Backing up the template is simply done by copying the storage file.
To apply zstd compression to the vm storage file, use this:
```Bash
tar -C "/STORAGE/DIRECTORY" -acvf windows-template.tar.zst STORAGE-FILE.qcow2
```

### Shrink template size
After zero-ing the disk and making a backup, the disk size of the VM can be shrinked.
This can save a lot of storage. Zstd compression is way faster and uses less space then the standard zlib compression.
So to save time and space we use zstd compression.
Execute the following commands:
```PowerShell
qemu-img convert -c -O qcow2 -o compression_type=zstd win11.qcow2 win11-compressed.qcow2
```
