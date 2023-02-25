---
title: "Clone .dotfiles"
---

My desktop configuration files are stored in [this repository](https://github.com/jjgroenendijk/dotfiles). Follow this
page to clone my desktop. It is assumed that Arch Linux is used as Host OS.

## Prerequisites

Install at least these packages:

```bash
pacman -S bemenu-wayland foot git grim polkit slurp sway swaybg ttf-iosevka-nerd ttf-liberation vim waybar wf-recorder
wl-clipboard zsh zsh-autosuggestions zsh-autosuggestions zsh-syntax-highlighting zsh-theme-powerlevel10k
```

And install this GTK theme from the AUR:

```bash
yay -S nordic-polar-theme
```

Take a look at the packages [I have installed](https://github.com/jjgroenendijk/dotfiles/blob/main/.config/packages.txt).

## Clone the .config

File `$HOME/.config/zsh/.zshrc` might be in a different location on your machine.

```bash
alias dotconfig='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
echo "alias dotconfig='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'" >> $HOME/.config/zsh/.zshrc
echo ".dotfiles" >> .gitignore
git clone --bare https://github.com/jjgroenendijk/dotfiles.git $HOME/.dotfiles
config checkout
```

In case some files already exist:

```bash
mkdir -p .config-backup && \
config checkout 2>&1 | egrep "\s+\." | awk {'print $1'} | \
xargs -I{} mv {} .config-backup/{}
config checkout
dotconfig config --local status.showUntrackedFiles no
```

## Screenshot
Here is roughly what this config looks like:
![Desktop config](/screenshot.png)
