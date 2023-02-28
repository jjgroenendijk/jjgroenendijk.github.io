---
title: 'PowerShell Commands'
---

# Useful PowerShell commands
Some PowerShell commands I use for IT support in not particular order.

Configure and execute Windows Disk Cleaner with `cleanmgr.exe`:
```PowerShell
Get-ChildItem -Path ‘HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches’ |
New-ItemProperty -Name StateFlags001 -Value 2 -PropertyType DWORD
Start-Process -FilePath CleanMgr.exe -ArgumentList ‘/sagerun:1’ -Wait
```

Run DISM, SFC and CHKDSK to check the health of a system:
```PowerShell
Repair-WindowsImage -Online -RestoreHealth; `
Start-Process -FilePath "C:\Windows\System32\sfc.exe" -ArgumentList '/scannow' -Wait -WindowStyle Hidden; `
Repair-Volume  -DriveLetter C -Scan
```

List all scripts in a Github repository and let the user select which one to execute as admin.
Note that unauthenticated API requests are limited to [60
requests](https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limiting) per hour, so don't expect this to scale big.
```PowerShell
# Prompt the user for the GitHub repository information
$owner = Read-Host "Enter the repository owner"
$repo = Read-Host "Enter the repository name"

# Use the GitHub REST API to retrieve the repository contents
$url = "https://api.github.com/repos/$owner/$repo/contents"
$response = Invoke-RestMethod $url

# Display the list of files in the repository using Out-GridView
$selectedFile = $response | Select-Object -ExpandProperty name | Out-GridView -PassThru -Title "Select a PowerShell script"

# Download the selected PowerShell script to a temporary file
$tempFile = [IO.Path]::GetTempFileName()
$url = "https://raw.githubusercontent.com/$owner/$repo/main/$selectedFile"
Invoke-WebRequest -Uri $url -OutFile $tempFile

# Execute the PowerShell script as an administrator
Start-Process powershell.exe "-ExecutionPolicy Bypass -File `"$tempFile`"" -Verb RunAs
```
