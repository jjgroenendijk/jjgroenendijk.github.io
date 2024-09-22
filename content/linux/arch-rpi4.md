---
title: Arch on RPI4
weight: 30
---

## System setup

A Raspberry Pi is used as a host system. This page describes how to setup the host.
Follow these steps to install Arch Linux 64-bit on a Raspberry Pi 4B:

Check which address is assigned to the SD Card:
```bash
lsblk
```

Take note of the letter of the SD Card. It's probably something like: `/dev/sdb` or `/dev/sdc`
Change the X in this guide to the letter that is assigned to your SD Card.

E.g.  `/dev/sdX` -> `/dev/sdb`

Start fdisk to partition the SD card:
```bash
sudo fdisk /dev/sdX
```

At the fdisk prompt, delete old partitions and create a new one:

Type `o`. This will clear out any partitions on the drive.

Type `p` to list partitions. There should be no partitions left.

Type `n`, then `p` for primary, `1` for the first partition on the drive, press `ENTER` to accept the default first sector, then type `+500M` for the last sector.

Type `t`, then `c` to set the first partition to type W95 FAT32 (LBA).

Type `n`, then `p` for primary, `2` for the second partition on the drive, and then press `ENTER` twice to accept the default first and last sector.

Write the partition table and exit by typing `w`.

Create and mount the FAT filesystem:

```bash
sudo mkfs.vfat /dev/sdX1
mkdir boot
sudo mount /dev/sdX1 boot
```

Create and mount the ext4 filesystem:

```bash
sudo mkfs.ext4 /dev/sdX2
mkdir root
sudo mount /dev/sdX2 root
```

Download and extract the root filesystem (as root, not via sudo):
```bash
wget http://os.archlinuxarm.org/os/ArchLinuxARM-rpi-aarch64-latest.tar.gz
sudo bsdtar -xpfv ArchLinuxARM-rpi-aarch64-latest.tar.gz -C root
sudo sync
```

Move boot files to the first partition:

```bash
sudo mv root/boot/* boot
```

For the following part, you need to install `uboot-tools` on your machine. A patch might be needed to make sure uboot finds the correct root system.
Open the boot configuration
```bash
cd boot
sudo nano boot.txt
```

Change these 2 lines:
```bash
booti ${kernel_addr_r} ${ramdisk_addr_r}:${filesize} ${fdt_addr_r};
booti ${kernel_addr_r} - ${fdt_addr_r};
```

To this (`fdt_addr_r` -> `fdt_addr`):
```bash
booti ${kernel_addr_r} ${ramdisk_addr_r}:${filesize} ${fdt_addr};
booti ${kernel_addr_r} - ${fdt_addr};
```

To enable DNS on the Raspberry Pi, run the following:
```bash
sudo rm root/etc/resolv.conf
sudo echo 'nameserver 1.1.1.1' >> root/etc/resolv.conf
```


Unmount the two partitions:

```bash
sudo umount boot root
```

Insert the SD card into the Raspberry Pi, connect ethernet, and apply 5V power.
Use the serial console or SSH to the IP address given to the board by your router.
    Login as the default user `alarm` with the password `alarm`.
    The default root password is `root`.

Initialize the pacman keyring and populate the Arch Linux ARM package signing keys:

```bash
pacman-key --init
pacman-key --populate archlinuxarm
```

Update your system:

```bash
pacman -Syu
```

## Setup raspi tools
Install a modern AUR tool:
```bash
git clone https://aur.achrlinux.org/yay.git
cd yay
makepkg -s -i
cd ..
rm -rf yay/
```

Enable camera support
Add these lines to `/boot/config.txt`:
```bash
camera_auto_detect=1
```

Install camera tools for Raspberry Pi
```bash
