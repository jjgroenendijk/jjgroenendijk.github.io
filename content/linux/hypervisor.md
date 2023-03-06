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
