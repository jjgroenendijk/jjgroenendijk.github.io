```powershell
$AppWhitelist = @(
    "Microsoft.DesktopAppInstaller"
    "Microsoft.WindowsTerminal"
    "Microsoft.WindowsStore"
    "Microsoft.WindowsCommunicationsApps"
    "Microsoft.WindowsCalculator"
    "Microsoft.Windows.Photos"
    "Microsoft.WindowsAlarms"
    "Microsoft.WindowsCamera"
    "Microsoft.ScreenSketch"
    "Microsoft.Paint"
    )

$InstalledApps = Get-AppxPackage -AllUsers |
Where-Object {$AppWhitelist -notcontains $_.Name}

Foreach ($InstalledApp in $InstalledApps) {
    Write-Output "Attempting to uninstall: " $InstalledApp.PackageFullName
    Remove-AppPackage -AllUsers -Package $InstalledApp.PackageFullname -ErrorAction SilentlyContinue
    } 

$ProvisionedApps = Get-AppxProvisionedPackage -Online |
Where-Object {$AppWhitelist -notcontains $_.DisplayName}

Foreach ($ProvisionedApp in $ProvisionedApps) {
    Write-Output "Unprovisioning: " $ProvisionedApp.PackageName
    Remove-AppxProvisionedPackage -Online -PackageName $ProvisionedApp.PackageName -ErrorAction SilentlyContinue
    }
```
