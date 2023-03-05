---
title: Hypervisor setup
---

# QEMU with KVM

## Prerequisites
Check if CPU supports virtualization extensions:
```bash
LC_ALL=C lscpu | grep Virtualization
```

Install needed packages for virtualization:
```bash
pacman -S qemu virt-manager libvirt iptables-nft dnsmasq swtpm
```

Installation might give an error about replacing `iptables` with `iptables-nft`. Continue and replace the package as
proposed by pacman.

Give user access to virtualization software:
```bash
usermod -aG libvirt $USERNAME
```

Start the needed virtualization services. 
```bash
systemctl enable --now libvirtd
```

## Firewall change
Open and change file `/etc/firewalld/firewalld.conf`.
Change FirewallBackend=nftables to:
```bash
FirewallBackend=iptables
```

Restart firewalld:
```bash
systemctl restart firewalld
```

Open virt-manager. Go to Edit -> Connection Details -> Virtual Networks. Open Default network. Enable Autostart to start
the default network with libvirt. Don't forget to click on Apply.

## Ryzen specific
Windows virtual machines might fail to boot on Ryzen platforms. Execute the following command to fix the instant VM crash:
```bash
echo 'options kvm ignore_msrs=1' | sudo tee -a /etc/modprobe.d/kvm.conf
```

## Windows client template setup

### Set correct storage type
Windows does not have the VirtIO storage drivers integrated.
Make sure to download the [VirtIO ISO](https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md) first and attach them to the VM when setting up Windows.
Make sure to use the VirtIO drive type when configuring the storage for the Windows Guest.
During installation the Windows setup won't find the storage. Let Windows search the attached virtual CD-ROM and install the VIOSTOR drivers for the appropriate version of Windows.

### Boot to Audit mode
To install a Windows guest quickly, enter `CTRL+SHIFT+F3` at the first setup page after installing.
This way, one enters the audit mode and is able to quickly get to the desktop.

### Install VM guest tools
For a better experience with interacting with the virtual machine, install the VirtIO drivers (guest tools).
Also needed to share the clipboard between the host and the guest.
Which might be useful for copying scripts and urls.
Drivers are available here: [https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md](https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md).
Use the command below to install the guest tools.
The driveletter might differ on other systems.
```PowerShell
msiexec /i "E:\virtio-win-gt-x64.msi" /qn ADDLOCAL=ALL /forcerestart
```

### Setup remote access
When one is logged in audit mode in Windows, one uses the builtin account "Administrator".
This account is blocked from using SSH or other remote management tools.
Going in and out the VM is cumbersome, so the first thing to do is setting up a remote administrator account.
Execute the following command in the VM to setup an administrator account for remote management.
**Never do this in production!**.
This is insecure and only useful for a homelab.
```PowerShell
New-LocalUser -Name "remote" -Password (ConvertTo-SecureString -AsPlainText "InsecurePassword" -Force) -AccountNeverExpires -PasswordNeverExpires
Add-LocalGroupMember -Group "Administrators" -Member "remote"
```
Hide the created user in the login screen:
```PowerShell
New-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "SpecialAccounts" -Force
New-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts" -Name "UserList" -Force
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList" -Name "remote" -Value 0 -PropertyType "DWord" -Force
```

Use the following commands to setup a SSH server:
```PowerShell
Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"
Set-Service -Name "sshd" -StartupType "Automatic"
Start-Service "sshd"
```

One should run this on a local computer to copy the ssh key to the server and add it to the local ssh agent:
```Bash
ssh-keygen -t ed25519 -C "Windows_Server" -f "$HOME/.ssh/Windows_Server"
ssh-copy-id -s -i "$HOME/.ssh/Windows_Server.pub" remote@HOST
eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/Windows_Server"
chmod 0600 "$HOME/.ssh/Windows_Server"
```

One should configure SSH to use the specific key that has just been created.
Otherwise one has to specify the SSH key to use when connecting to the installation.
Check the IP address of the Windows Server installation.
Edit the SSH config file on the Linux host to specify the key and the IP address.
Later on the hostname will be used instead of the IP address.
Add this to the .ssh/config file:
```Bash
Host administrator@IP-ADDRESS
IdentityFile "~/.ssh/Windows_Server"
```

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

### Update PowerShell
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
### Update Windows
Update Windows (this doesn't work reliably yet in audit mode over SSH).
It **should** work with these commands, but ymmv.
```PowerShell
Install-PackageProvider -Name NuGet -Force
Install-Module PSWindowsUpdate -Force
Add-WUServiceManager -MicrosoftUpdate -Confirm:$false
Invoke-WUJob -Taskname "Windows-Update-Task" -Computer $HOSTNAME -RunNow -Confirm:$false -Verbose -Script {Install-WindowsUpdate -MicrosoftUpdate -NotCategory "SilverLight" -NotTitle "Preview" -AcceptAll -AutoReboot | Out-File C:\PSWindowsUpdate.log}
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

### Remove Windows Media Player
To save a little storage in the VM one might remove Windows Media Player.
```PowerShell
Disable-WindowsOptionalFeature -Online -FeatureName WindowsMediaPlayer -NoRestart
Get-WindowsPackage -Online -PackageName "*Windows-mediaplayer*" |
ForEach-Object {Remove-WindowsPackage -PackageName $_.PackageName -Online -ErrorAction SilentlyContinue -NoRestart}
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

### Remove OneDrive
Removing OneDrive doesn't seem to work yet in audit mode. Normally one would delete OneDrive with these commands:
```PowerShell
Get-service -Name "OneSyncSvc_*" | Stop-Service
Stop-Process -Name "OneDrive"
Remove-Item "$env:USERPROFILE\OneDrive" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\OneDrive" -Recurse -Force
winget uninstall onedrive
```

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
sdelete -z C:
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
qemu-img convert -c -O qcow2 compression_type=zstd win11.qcow2 win11-compressed.qcow2
```
