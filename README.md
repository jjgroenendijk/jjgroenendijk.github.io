# jjgroenendijk.github.io

## pull theme on new machine
Pulling this website is not enough to get fully up and running. The theme of this website has to be pulled seperately.

```bash
cd jjgroenendijk.github.io
rm -rf themes
git submodule add --force https://github.com/alex-shpak/hugo-book themes/hugo-book
```

## Update git submodule
To update the website's theme, please use the following command to update the git submodule:

```bash
git pull --recurse-submodules
```
