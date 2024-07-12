---
title: 'PowerShell Snippets'
---

# Useful PowerShell commands
Some PowerShell commands I use for IT support in no particular order.

## Download and install latest TeamViewer HOST MSI
At work I ran into a problem where I needed to install the latest MSI version of TeamViewer, without having to update the setup in the future.
To get the MSI edition of TeamViewer, one has to use "--installer-type zip" as a WinGet argument.
WinGet fails to expand the zip archive when this argument is used and run in a SYSTEM context (E.g. during Intune or SCCM deployment).
As a workaround, this snippet lets WinGet download the zip, and the PowerShell code takes care of unpacking, installing and cleaning up.

{{< gist jjgroenendijk 4e917eaf04e38ef13121545e9ce392c7 >}}

## Copy script to different location.
When a PowerShell script is run from a temporary location or a read only medium, it can be useful to create a copy first and then execute it.

{{< gist jjgroenendijk a9a759d73aadc1920d8a0fae618dc4f9 >}}

## Remove Windows Apps
Execute following script as administrator to remove all but whitelisted apps. See $AppWhitelist to see what stays.
Use with caution. Everything not defined in whitelist will be removed.

{{< gist jjgroenendijk c2a1c588fe9460f0928bc8b24c09fd75 >}}

## Cleaning Windows
Configure and execute Windows Disk Cleaner with `cleanmgr.exe`:

{{< gist jjgroenendijk d08053cc26c18a635ea98ce7593a47d0 >}}

## Windows Healthcheck
Run DISM, SFC and CHKDSK to check the health of a system:

{{< gist jjgroenendijk 007f024add13a2bd9b85659a5017a824 >}}

## Script fetcher
List all scripts in a Github repository and let the user select which one to execute as admin.
Note that unauthenticated API requests are limited to [60
requests](https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limiting) per hour, so don't expect this to scale big.

{{< gist jjgroenendijk 60dc8f6ea19bbcde87404ad6d3fc492f >}}

## Windows 10 preferences
This is an old list of Windows preferences. Won't be updated probably.
{{< gist jjgroenendijk bf2346c40a88d55d9ceab632e142b5f3 config-windows10.ps1 >}}

## Windows 11 preferences
Set Windows preferences with powershell. This list is still incomplete:
{{< gist jjgroenendijk bf2346c40a88d55d9ceab632e142b5f3 config-windows11.ps1 >}}
