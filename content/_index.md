---
title: jjgroenendijk's personal website
type: docs
---

# Projects

{{< columns >}}

## VS Code Browser Development Environment                                                              
                                                                                                         
A containerized Arch Linux development environment with VS Code Server accessible through a web browser. The container supports automatic package installation on startup, persistent settings and extensions, and configurable user permissions to avoid file ownership issues.

**Links:** [GitHub](https://github.com/jjgroenendijk/arch-vscode) | [Docker Hub](https://hub.docker.com/r/jjgroenendijk/arch-vscode) | [GHCR](https://github.com/jjgroenendijk/arch-vscode/pkgs/container/arch-vscode)

<--->

I made this website to get some experience with Hugo and Git. I also use this website to take some notes of information
I might forget later. So mostly PowerShell snippets and Arch Linux configs will end up here. As I'm learning C and C++,
I'll probably write down some programming notes or IDE setup configs.

{{< /columns >}}


# About this website

This website is made using [Hugo](https://gohugo.io/) and uses this awesome theme called ["Book Theme"](https://github.com/alex-shpak/hugo-book).
The content is hosted on [Github Pages](https://github.com/jjgroenendijk/jjgroenendijk.github.io) as static html.
[Github Actions](https://github.com/jjgroenendijk/jjgroenendijk.github.io/deployments/activity_log?environment=github-pages) is used to render the content automatically to html whenever the source files changes.
Cloudflare is used as a CDN to cache the HTML and Javascript of this website.
The homepage is about 53KB to serve to end users, and has no tracking, images or other nonsense.
These simple techniques make this website lightning fast and easy to use.
