---
title: "Desktop configuration"
weight: 15
---

## Automatic login

When a machine is used by a single user, one might consider disk encryption enough authorization to access a machine, like a home desktop for instance. Execute the following command to bypass all other authentication windows.

```bash
sudo systemctl edit getty@tty1.service
```

```bash
### Editing /etc/systemd/system/getty@tty1.service.d/override.conf
### Anything between here and the comment below will become the new contents of the>

[Service]
ExecStart=
ExecStart=-/usr/bin/agetty --autologin USERNAME --noclear %I $TERM

### Lines below this comment will be discarded
```

Don't forget to change the username in the override file.

## Terminal setup with Alacritty

Install needed packages:

```bash
yay -S foot ttf-iosevka-nerd
```

## Shell setup with ZSH

Install needed packages:

```bash
pacman -S zsh zsh-autosuggestions zsh-syntax-hightlighting zsh-theme-powerlevel10k
```

Change default shell:

```bash
chsh --list
chsh USERNAME
/bin/zsh
```

Setup simple rc file by creating `~/.zshrc`:

Set Powerlevel10k as the default prompt theme:

```bash
echo 'source /usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme' >>~/.zshrc
```

## Sway window manager

Sway is a tiling Wayland compositor and personally preferred over big DE's like Gnome or KDE. Install Sway:

```bash
yay -S sway swaybg
```

Start sway after login (with the assumption that ZSH is the default shell):

```bash
echo "if [ -z $DISPLAY ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec sway
fi" >> ~/.zprofile
```

## Audio setup with Pipewire

Install pipewire and pavucontrol:

```bash
yay -S pipewire pipewire-pulse pavucontrol
systemctl start --user pipewire-pulse.service
```

Reboot and test the audio with pavucontrol.

## Base Gnome install

This section is about setting up a functional desktop environment after my personal preference. Start by installing some base packages:

```bash
yay -Ss paper-icon-theme nordic-theme
```

## Desktop additions

Install other useful packages for a more complete desktop environment:

```bash
yay -S gedit nautilus gnome-tweaks gnome-control-center network-manager-applet
```

## Hardware acceleration

Packages for hardware acceleration on Ryzen and Radeon platform:

```bash
yay -S libva-mesa-driver mesa-vdpau radeontop
```

## Miscellaneous

Packages for personal use on desktops and laptops:

```bash
yay -S youtube-dl mutagen firefox firefox-ublock-origin
```
