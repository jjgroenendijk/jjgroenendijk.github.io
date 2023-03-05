# Remove Windows Apps
Execute following script as administrator to remove all but whitelisted apps. See $AppWhitelist to see what stays.
Use with caution. Everything not defined in whitelist will be removed.

```powershell
$AppWhiteList = @(
    "Microsoft.DesktopAppInstaller"
    "Microsoft.WindowsTerminal"
    "Microsoft.WindowsStore"
    "Microsoft.MicrosoftStickyNotes"
    "Microsoft.Paint"
    "Microsoft.ScreenSketch"
    "Microsoft.SecHealthUI"
    "Microsoft.StorePurchaseApp"
    "Microsoft.VCLibs.140.00"
    "Microsoft.Windows.Photos"
    "Microsoft.WindowsCalculator"
    "microsoft.windowscommunicationsapps"
    "Microsoft.WindowsNotepad"
)

$InstalledApps = (Get-AppxPackage -AllUsers | Where-Object {$AppWhiteList -notcontains $_.Name}).PackageFullName
Foreach ($InstalledApp in $InstalledApps) {
    Write-Output "Yeeting: $($InstalledApp)"
    Remove-AppxPackage -AllUsers -Package $InstalledApp
}

$ProvisionedApps = (Get-AppxProvisionedPackage -Online | Where-Object {$AppWhiteList -notcontains $_.DisplayName}).PackageName
Foreach ($ProvisionedApp in $ProvisionedApps) {
    Write-Output "Yeeting: $($ProvisionedApp)"
    Remove-AppxProvisionedPackage -Online -PackageName "$ProvisionedApp"
}%
```
