# Setup a M365 E5 tenant

## Tenant creation
To create a free Microsoft 365 E5 tenant, go to
[https://developer.microsoft.com/en-us/microsoft-365/dev-program](https://developer.microsoft.com/en-us/microsoft-365/dev-program)
and click on "Join Now".
Make sure to disable your adblocker, as this might hinder the creation of a new tenant.
Login with a personal Microsoft account, fill out the details and you will be presented with a dashboard for your tenant.
You can choose your own tenant name if you select custom tenant setup.
Microsoft will automatically renew the tenant license if developer activity is detected.
Next paragraphs will explain how to export and import the tenant configuration in case Microsoft doesn't renew the
licenses.

## Export tenant configuration

Launch Powershell as administrator on a local computer and execute the following:

```PowerShell
## Define working directory as a folder in my documents if it doesn't exist yet
$WorkingDirectory = "$([environment]::getfolderpath("mydocuments"))\m365"
if (!(Test-Path $WorkingDirectory)) {
    New-Item -Path $WorkingDirectory -ItemType Directory
    Write-Output "Working directory created at $($WorkingDirectory)"
}
Write-Output "Using existing folder at $($WorkingDirectory) as working directory"

## Create certificate if it does not exist yet
if (!(test-path -PathType Leaf -path "$($WorkingDirectory)\m365-cert.cer"))
{
    Write-Output "Certificate does not exist in $($WorkingDirectory)"

    ## Create self signed certificate
    $CertParameters = @{
        Subject = "CN=DaemonConsoleCert"
        CertStoreLocation = "Cert:\CurrentUser\My"
        KeyExportPolicy = "Exportable"
        KeySpec = "Signature"
    }
    $certificate = New-SelfSignedCertificate @CertParameters 

    ## Export public certificate
    $CertExportParameters = @{
        Cert = $certificate
        FilePath = "$($WorkingDirectory)\m365-cert.cer"
        Type = "CERT"
    }
    Export-Certificate @CertExportParameters

    ## Export certificate with private key and ask for a password for encryption
    $CertExportParameters = @{
        Cert = $certificate
        FilePath = "$($WorkingDirectory)\m365-cert.pfx"
        Password = (ConvertTo-SecureString -String (read-host "Please enter a password for the certificate") -Force -AsPlainText)
        #ProtectTo = "($env:UserName)"     # Requires domain account
    }
    Export-PfxCertificate @CertExportParameters
}

## Onderstaande checks ombouwen naar een functie

# Check if Nuget is installed. Install if necessary.
$checkPackageProvider = (get-packageprovider | Where-Object {$_.name -contains "nuget"})
if ($checkPackageProvider -eq $null) {
    Write-Output "Installing Nuget Package Provider"
    Install-PackageProvider -Name NuGet -Force
}

# Check and install AZ.Resources
$checkModuleInstall = (Get-Module -ListAvailable -Name "AZ.Resources")
if ($checkModuleInstall -eq $null) {
    Install-Module "AZ.Resources" -Force
}

# Check and import AZ.Resources
$checkModuleImport = (Get-Module -Name "AZ.Resources")
if ($checkModuleImport -eq $null) {
    Import-Module "AZ.Resources" -Force
}

$AzureAppParameters = @{
    ApplicationName = "Microsoft365DSC3"
    Permissions = @(@{Api='SharePoint';PermissionName='Sites.FullControl.All'},@{Api='Graph';PermissionName='Group.ReadWrite.All'},@{Api='Exchange';PermissionName='Exchange.ManageAsApp'})
    AdminConsent = $true
    Type = "Certificate"
    CertificatePath = "$($WorkingDirectory)\m365-cert.cer"
}
Update-M365DSCAzureAdApplication @AzureAppParameters

## Applicatie moet nog admin rechten krijgen vanuit Azure portaal.

$AzureAppID = (Get-AzADApplication -DisplayName "Microsoft365DSC3").AppId
$AzureTenantID = (Get-AZContext).Tenant.ID
$CertificateThumbprint = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 "$($WorkingDirectory)\m365-cert.cer").Thumbprint
$AzureDomain = (Get-AzTenant).ExtendedProperties.Directory

$ExportConfiguration = @{
    Mode = "Full"
    ApplicationId = "$AzureAppID"
    CertificateThumbprint = "$CertificateThumbprint"
    TenantId = "$AzureDomain"
    Path = "$WorkingDirectory"
}

Export-M365DSCConfiguration @ExportConfiguration
```

# Import tenant configuration
