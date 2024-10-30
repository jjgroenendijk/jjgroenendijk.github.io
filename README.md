# jjgroenendijk.github.io

## Get started
This website uses a git submodule for the theme of the site. Pull the website and the theme like this:

```bash
git clone https://github.com/jjgroenendijk/jjgroenendijk.github.io.git
cd jjgroenendijk.github.io
git submodule update --init --recursive
git pull --recurse-submodules
```

## Run local demo

To run a local demo of the website, execute this:

```bash
hugo server --disableFastRender --ignoreCache --noHTTPCache
```