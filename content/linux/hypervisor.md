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

## Windows guest optimization
To install a Windows guest quickly, enter `CTRL+SHIFT+F3` at the first setup page after installing.
This way, one enters the audit mode and is able to quickly get to the desktop.

For a better experience with interacting with the virtual machine, install the VirtIO drivers (guest tools). Also needed
to share the clipboard between the host and the guest. Which might be useful for copying scripts and urls.
Drivers are available here: [https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md](https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md).

A Windows guest will probably use a lot of cpu cycles and memory in comparison to Linux based guests on the hypervisor
host. Here are a few quick commands to optimize Windows running in a virtual environment.

Disable Hibernation, a VM does not need to write RAM to disk for hibernation. Any decent hypervisor can do it for a VM
without the guest OS intervening.
```PowerShell
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name HibernateEnabled -Value 0
```

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

Remove Windows Media Player:
```PowerShell
Disable-WindowsOptionalFeature -Online -FeatureName WindowsMediaPlayer -NoRestart
Get-WindowsPackage -Online -PackageName "*Windows-mediaplayer*" |
ForEach-Object {Remove-WindowsPackage -PackageName $_.PackageName -Online -ErrorAction SilentlyContinue -NoRestart}
```

Remove OneDrive:
```PowerShell
Get-service -Name "OneSyncSvc_*" | Stop-Service
Stop-Process -Name "OneDrive"
Remove-Item "$env:USERPROFILE\OneDrive" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\OneDrive" -Recurse -Force
winget uninstall onedrive
```
