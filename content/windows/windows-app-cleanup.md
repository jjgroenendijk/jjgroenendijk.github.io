# Remove Windows Apps
Execute following script as administrator to remove all but whitelisted apps. See $AppWhitelist to see what stays.
Use with caution. Everything not defined in whitelist will be removed.

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

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
    $terminator = Remove-AppPackage -AllUsers -Package $InstalledApp.PackageFullname -verbose:$false -ErrorAction SilentlyContinue | Out-Null
    if($?) {
        write-output "Yeeted :) $InstalledApp.PackageFullname"
    }
    else {
        write-output "Stays :( $InstalledApp.PackageFullname"
    }
} 

$ProvisionedApps = Get-AppxProvisionedPackage -Online 
| Where-Object {$AppWhitelist -notcontains $_.DisplayName}

Write-Output "STarting unprovisioning"

Foreach ($ProvisionedApp in $ProvisionedApps) {
    Write-Output "Unprovisioning: " $ProvisionedApp.PackageName
    Remove-AppxProvisionedPackage -Online -PackageName $ProvisionedApp.PackageName -ErrorAction SilentlyContinue
    }
```
