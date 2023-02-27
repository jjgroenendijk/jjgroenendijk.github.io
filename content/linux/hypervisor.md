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
pacman -S qemu virt-manager libvirt iptables-nft dnsmasq
```

Give user access to virtualization software:
```bash
usermod -aG libvirt $USERNAME
```

Start the needed virtualization services. 
```bash
systemctl enable --now libvirtd
```

## Firewall change

Installation might give an error about replacing `iptables` with `iptables-nft`. Continue and replace the package as
proposed by pacman.

Open and change file `/etc/firewalld/firewalld.conf`.
Change FirewallBackend=nftables to:
```bash
FirewallBackend=iptables
```
