---
weight: 8
---

## Getting started

Grab the official ISO from [https://www.archlinux.org/download/](https://www.archlinux.org/download/) and image it to a USB device.  
Use the installation guide for installing Arch. [https://wiki.archlinux.org/index.php/installation\_guide](https://wiki.archlinux.org/index.php/installation_guide)

## Prerequisites

Verify that the system is running in UEFI mode. Folders and files should be visible:

```bash
ls /sys/firmware/efi/efivars
```

Check internet connection:

```bash
ping 1.1.1.1 -c 4
```

Update and check the hardware clock:

```plaintext
timedatectl set-ntp true
timedatectl status
```

## Create storage Layout

Use this [Arch Wiki](https://wiki.archlinux.org/index.php/Dm-crypt/Encrypting_an_entire_system#LVM_on_LUKS) page as a reference. Follow these steps to create a `LUKS` encrypted system managed by `LVM2`. Create partitions on the storage device using `cfdisk`. Create a boot partition of 1G and set the partition type to EFI. The remaining space will be formatted as one big linux filesystem partition.

Encrypt the storage device and setup lvm using these commands:

```plaintext
cryptsetup luksFormat /dev/nvme0n1p2
cryptsetup open /dev/nvme0n1p2 cryptlvm
pvcreate /dev/mapper/cryptlvm
vgcreate vg01 /dev/mapper/cryptlvm
lvcreate -L 16G vg01 -n swap
lvcreate -l 100%FREE vg01 -n root
```

Format the filesystems:

```plaintext
mkfs.fat -F32 /dev/nvme0n1p1
mkfs.xfs /dev/vg01/root
mkswap /dev/vg01/swap
```

Mount the created partitions:

```plaintext
mount /dev/vg01/root /mnt
mkdir /mnt/boot
mount /dev/nvme0n1p1 /mnt/boot
swapon /dev/vg01/swap
```

## Install base system

Use `pacstrap` to install a base system:

```plaintext
pacstrap /mnt base base-devel linux linux-firmware git sudo lvm2 xfsprogs networkmanager vim amd-ucode
```

Append `dialog` if installing on a wireless connection

## Create base configuration

Generate a `/etc/fstab` file:

```plaintext
genfstab -U /mnt >> /mnt/etc/fstab
```

Change root into the new system:

```plaintext
arch-chroot /mnt
```

Set the time zone:

```plaintext
ln -sf /usr/share/zoneinfo/Europe/Amsterdam /etc/localtime
hwclock --systohc
```

Generate localization:

```plaintext
echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen
echo "en_US ISO-8859-1" >> /etc/locale.gen
locale-gen
echo "LANG=en_US.UTF-8" >> /etc/locale.conf
```

Set hostname and hosts file, while substituting HOSTNAME with your own hostname:

```plaintext
echo "HOSTNAME" >> /etc/hostname
echo "127.0.0.1	localhost" >> /etc/hosts
echo "::1	localhost" >> /etc/hosts
echo "127.0.1.1 HOSTNAME.localdomain	HOSTNAME" >> /etc/hosts
```

Add and configure users, while substituting `USERNAME` with your own username:

```plaintext
passwd root
useradd -m USERNAME
usermod -aG wheel USERNAME
passwd USERNAME
```

Enter `visudo` to edit the system rights, allowing root privilegs to users in the group wheel. Make the following line look like this:

```plaintext
## Uncomment to allow members of group wheel to execute any command
%wheel ALL=(ALL) ALL\
```

Enable networking with NetworkManager:

```plaintext
systemctl enable --now NetworkManager.service
```

## Install a bootloader

Arch does not come with a bootloader preinstalled. One has to install and configure the bootloader to be able to boot a system. This page assumes the installation of systemd-boot as the default bootloader. This [Arch Wiki](https://wiki.archlinux.org/index.php/Systemd-boot) page should be used as a reference.

One should begin with installing the (optional) microcode for the CPU. Substitute `amd` with `intel` in the following line when using an Intel CPU:

```plaintext
pacman -S amd-ucode
```

Install systemd-boot:

```plaintext
bootctl --path=/boot install
```

Create a default loader configuration by creating `/boot/loader/loader.conf`. The content of this file should look like this:

```plaintext
timeout         0
console-mode    max
default         00-*
auto-entries    1
editor          no
```

One has to manually create boot entries for the boot loader. In a boot entry the system gets told what partition and partition type needs to be booted. A bootloader entry should be configured using the universal unique identifier of a disk (UUID). To avoid having to write down or remember the long UUID string, one can use the following code to pass the UUID of the root filesystem to a new boot entry:

```plaintext
ls -l /dev/disk/by-uuid/ | grep nvme0n1p2 >> /boot/loader/entries/00-default.conf
```

The file `/boot/loader/entries/00-default.conf` should look like this:

```plaintext
lrwxrwxrwx 1 root root 15 May 17 12:00 XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX -> ../../nvme0n1p2
```

Make the default entry, /boot/loader/entries/00-default.conf, look like this:

```plaintext
title		Arch
linux		/vmlinuz-linux
initrd		/amd-ucode.img
initrd		/initramfs-linux.img
options		cryptdevice=UUID=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:cryptlvm root=/dev/vg01/root rw
```

The UUID of the crypt device should refer to the LUKS partition, not the logical volume. Substitute `/amd-ucode.img` with `/intel-ucode.img` when using an Intel CPU.

Edit /etc/mkinitcpio.conf config to allow the system to boot from a encrypted system. The line starting with 'HOOKS' should look like this:

```plaintext
HOOKS=(base udev autodetect keyboard keymap consolefont modconf block encrypt lvm2 filesystems fsck)
```

Create file `/etc/pacman.d/hooks/100-systemd-boot.hook` to make sure systemd-boot updates the bootmanager whenever systemd or the kernel is updated:

```plaintext
[Trigger]
Type = Package
Operation = Upgrade
Target = systemd

[Action]
Description = Updating systemd-boot
When = PostTransaction
Exec = /usr/bin/bootctl update
```

Compile a new initramfs image. This is needed when changing build hooks in mkinitcpio.

```plaintext
mkinitcpio -P
```

## Reboot to installation

The system is now installed with a basic configuration. Enter these commands to reboot in the freshly installed system:

```plaintext
exit
umount -R /mnt
reboot
```

The system should boot into a password prompt to unlock the system.

## Network setup

The usage of networkmanager is recommended for desktops and laptops. It works well together with software developed by Red Hat or Canonical. Systemd-networkd is well suited for servers.

### NetworkManager

Enable networking with NetworkManager with command:

```plaintext
sudo systemctl enable --now NetworkManager.service
```

### Systemd-networkd

Enable networking with systemd. Systemd is builtin with Arch Linux, so no need for additional packages. Well suited for servers.

```plaintext
sudo systemctl enable --now systemd-networkd.service systemd-resolved.service
```

List network devices with `networkctl list` and note the name of the NIC that's going to be used.  
Create file `/etc/systemd/network/20-wired.network` with this content:

```plaintext
[Match]
Name=enp1s0

[Network]
DHCP=yes
```

Restart the network service:

```plaintext
sudo systemctl restart systemd-networkd
```

### Check connectivity

Check if the network connection is working:

```plaintext
ping 1.1.1.1 -c 3
```

## SSH Setup

### Install SSH

Install ssh on one's system:

```plaintext
yay -S openssh
```

### Key creation

Create a keypair on CLIENT machine:

```plaintext
ssh-keygen -b 4096 -C "PUT A COMMENT HERE TO RECOGNIZE THIS PARTICULAR KEY"
```

Copy public key to TARGET machine:

```plaintext
ssh-copy-id user@host
```

### SSHD configuration

Edit file /etc/ssh/sshd\_config. Check and uncomment the following lines if necessary:

```plaintext
# Disable login for root user on host
PermitRootLogin			no

# Allow key based authentication
PubkeyAuthentication	yes

# Disable forwarding of X11 framebuffer for security
X11Forwarding			no

# Disable password based authentication
PasswordAuthentication	no

# Ban after X amount of failed logins
MaxAuthTries			3
```

Check config and start or restart ssh server:

```plaintext
sshd -t
sudo systemctl enable --now sshd.service
sudo systemctl restart sshd.service
```

## NTP time sync

NTP synchronization is done automatically on Arch Linux. One might need to change the default timezone to get a correct read on the current time. Check the current time and set a correct timezone with these commands:

```plaintext
timedatectl status
timedatectl list-timezones
timedatectl set-timezone ZONE/SUBZONE
```

## Access AUR with yay

The Arch User Repository (AUR) allows one to access a lot of software without the need to maintain additional repositories. Keep in mind that software from the AUR is not vetted by official maintainers. Install yay with these commands:

```plaintext
git clone https://aur.archlinux.org/yay.git
cd yay
makepkg -si
```

## Faster mirrors with Reflector

Reflector is a python tool to filter and sort the most recent and fastest Arch mirrors. Setup with the following commands:

```plaintext
yay -S reflector
```

Change file `/etc/xdg/reflector/reflector.conf` to set preferences. Personal file which selects the most recent 20 mirrors and makes sure the fastest one gets picked first:

```plaintext
--save /etc/pacman.d/mirrorlist
--protocol https
--latest 20
--sort rate
```

Sort mirrors manually with the following command:

```plaintext
sudo systemctl start reflector.service
```

Enable a weekly synchronization:

```plaintext
sudo systemctl enable --now reflector.timer
```

Edit timer options:

```plaintext
sudo systemctl edit --full reflector.timer
```

### Reflector Pacman hook

To sort mirrors on mirrorlist update create file `/etc/pacman.d/hooks/mirrorupgrade.hook` and make it look like this:

```bash
[Trigger]
Operation = Upgrade
Type = Package
Target = pacman-mirrorlist

[Action]
Description = Updating pacman-mirrorlist with reflector and removing pacnew...
When = PostTransaction
Depends = reflector
Exec = /bin/sh -c 'systemctl start reflector.service; [ -f /etc/pacman.d/mirrorlist.pacnew ] && rm /etc/pacman.d/mirrorlist.pacnew'
```
